import manifest from "../manifest.json";
import metricsData from "../data/metrics.json";
import type { AnalyticsAdapter, AnalyticsConnection, AnalyticsResult, ReadRequest } from "@opengroow/publisher-sdk";

// The Google Search Console Analytics Adapter (ADR-079). A page is found by its public URL. The
// answers were recorded on a real property (docs/research/search-console in OpenGroow):
//  - sign in with a service account: a JWT signed RS256, exchanged at the token endpoint;
//  - `searchAnalytics.query` with `dimensions: ["page"]`, a `page equals <URL>` filter and
//    `dataState: "final"`, which ends two days ago, answers one row {clicks, impressions, position};
//  - a page the service does not know, or a range with no final data, answers 200 with no `rows`:
//    it is "no data yet", not an error.
// Clicks and impressions are read over [publication day, today - 2] (cumulative); the position is
// the average over the last 7 final days. The CTR is derived by the core, never read.

const DAY = 86_400_000;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const FINAL_LAG_DAYS = 2;
const POSITION_DAYS = 7;
const LABELS: Record<string, string> = metricsData.labels;

type Failure = { ok: false; error: string };
type Row = { clicks?: unknown; impressions?: unknown; position?: unknown };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const base64url = (input: string | ArrayBuffer) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

type ServiceAccount = { client_email: string; private_key: string };

function parseKey(raw: string): ServiceAccount | Failure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The service account key is not valid JSON: paste the JSON file downloaded from Google Cloud" };
  }
  const key = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const missing = ["client_email", "private_key"].filter((f) => typeof key[f] !== "string" || key[f] === "");
  if (missing.length > 0) return { ok: false, error: `The service account key lacks the field${missing.length > 1 ? "s" : ""} ${missing.join(", ")}` };
  return { client_email: key.client_email as string, private_key: key.private_key as string };
}

/** The PKCS#8 PEM of a service account key as an RSA signing key (Web Crypto: no Node-only import). */
async function importPrivateKey(pem: string): Promise<CryptoKey | undefined> {
  try {
    const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    return undefined;
  }
}

async function signedAssertion(account: ServiceAccount, nowMs: number): Promise<string | Failure> {
  const key = await importPrivateKey(account.private_key);
  if (!key) return { ok: false, error: "The private key of the service account key cannot be read (expected a PKCS#8 PEM)" };
  const iat = Math.floor(nowMs / 1000);
  const claims = { iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
  const input = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${base64url(signature)}`;
}

async function send(url: string, init: RequestInit, who: string): Promise<{ ok: true; status: number; body: unknown } | Failure> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return { ok: false, error: `Could not reach ${who}: ${error instanceof Error ? error.message : String(error)}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: `${who} returned an unreadable response` };
  }
  return { ok: true, status: response.status, body };
}

async function accessToken(account: ServiceAccount, nowMs: number): Promise<string | Failure> {
  const assertion = await signedAssertion(account, nowMs);
  if (typeof assertion !== "string") return assertion;
  const res = await send(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    },
    "Google sign-in",
  );
  if (!res.ok) return res;
  const body = (res.body ?? {}) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  if (res.status >= 400 || typeof body.access_token !== "string") {
    const why = [body.error, body.error_description].filter((v) => typeof v === "string").join(": ");
    return { ok: false, error: `Google refused the service account key (${res.status}${why ? `, ${why}` : ""})` };
  }
  return body.access_token;
}

/** The first row Search Console answers for the page over a window; `undefined` when it has none. */
async function query(token: string, property: string, page: string, startDate: string, endDate: string): Promise<{ ok: true; row?: Row } | Failure> {
  const res = await send(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page"],
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: page }] }],
        dataState: "final",
      }),
    },
    "Search Console",
  );
  if (!res.ok) return res;
  if (res.status >= 400) {
    const message = (res.body as { error?: { message?: unknown } } | null)?.error?.message;
    const detail = typeof message === "string" ? `: ${message}` : "";
    const hint =
      res.status === 403
        ? " (add the service account's email as a user of the property in Search Console, Settings > Users and permissions, and check the Search Console API is enabled)"
        : res.status === 404
          ? " (check the domain: the service account must be a user of the domain property sc-domain:<domain> in Search Console)"
          : "";
    return { ok: false, error: `Search Console responded ${res.status}${detail}${hint}` };
  }
  const rows = (res.body as { rows?: unknown } | null)?.rows;
  if (rows === undefined) return { ok: true }; // no rows: the page is unknown or has no final data yet
  if (!Array.isArray(rows)) return { ok: false, error: "Search Console returned an unexpected answer" };
  return { ok: true, row: rows[0] as Row | undefined };
}

/**
 * The option asks for a domain name only (`example.com`); the property is the domain property `sc-domain:example.com`.
 * A pasted `https://www.example.com/blog` or `sc-domain:example.com` is reduced to the same domain.
 */
export function propertyOf(conn: AnalyticsConnection): string | undefined {
  const value = conn.options?.domain;
  if (typeof value !== "string") return undefined;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
  return host === "" ? undefined : `sc-domain:${host}`;
}

/** Search Console knows a page by its https address: an http one is tried as https first, then as given. */
function pageVariants(url: string): string[] {
  return url.startsWith("http://") ? [`https://${url.slice("http://".length)}`, url] : [url];
}

/** The first variant of the page that Search Console has a row for (the last answer when none has). */
async function queryPage(token: string, property: string, url: string, startDate: string, endDate: string): Promise<{ ok: true; row?: Row; page: string } | Failure> {
  let last: { ok: true; row?: Row; page: string } = { ok: true, page: url };
  for (const page of pageVariants(url)) {
    const answer = await query(token, property, page, startDate, endDate);
    if (!answer.ok) return answer;
    last = { ...answer, page };
    if (answer.row) return last;
  }
  return last;
}

/** A row's numbers under the metric keys of the labels file: only finite numbers. */
function metricsOf(row: Row | undefined, only: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const label of only) {
    const key = LABELS[label];
    const value = (row as Record<string, unknown> | undefined)?.[label];
    if (key && typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export const searchConsoleAnalytics: AnalyticsAdapter = {
  id: manifest.id,
  name: manifest.name,
  contractVersion: manifest.contractVersion,
  needs: "url",
  earliestDelayMs: manifest.earliestDelayMs,

  async read(conn, request: ReadRequest): Promise<AnalyticsResult> {
    if (!request.url) return { ok: false, error: "The Publication has no page URL to read" };
    const property = propertyOf(conn);
    if (!property) return { ok: false, error: "Set the domain of the site (example.com) in the connection options" };
    const account = parseKey(conn.apiKey);
    if ("ok" in account) return account;

    const now = Date.now();
    const end = day(now - FINAL_LAG_DAYS * DAY);
    const start = day(request.publishedAt);
    if (start > end) return { ok: true, reading: { status: "no_data" } }; // no final day since publication yet

    const token = await accessToken(account, now);
    if (typeof token !== "string") return token;

    const total = await queryPage(token, property, request.url, start, end);
    if (!total.ok) return total;
    const metrics = metricsOf(total.row, ["clicks", "impressions"]);
    if (!total.row || Object.keys(metrics).length === 0) return { ok: true, reading: { status: "no_data" } };

    const recentStart = day(now - (FINAL_LAG_DAYS + POSITION_DAYS - 1) * DAY);
    const recent = await query(token, property, total.page, recentStart > start ? recentStart : start, end);
    if (!recent.ok) return recent;
    Object.assign(metrics, metricsOf(recent.row, ["position"]));
    return { ok: true, reading: { status: "taken", metrics } };
  },
};
