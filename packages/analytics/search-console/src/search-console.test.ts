import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchConsoleAnalytics } from "./search-console";
import manifest from "../manifest.json";
import metricsData from "../data/metrics.json";
import cumulative from "../fixtures/page-cumulative.json";
import position7d from "../fixtures/page-position-7d.json";
import unknownPage from "../fixtures/page-unknown.json";
import futureRange from "../fixtures/future-range.json";

// The plugin contract, with Search Console stubbed at fetch by the answers recorded on a real
// property (docs/research/search-console in OpenGroow, #105). The key is a throwaway RSA key
// generated here: no real credential is involved.

const PAGE = "https://example.com/blog/article-1";
const PUBLISHED = Date.parse("2026-10-10T08:00:00Z");
// Recorded with `today - 2` = 2026-11-16, so "today" is 2026-11-18.
const NOW = Date.parse("2026-11-18T09:00:00Z");
const REQUEST = { url: PAGE, publishedAt: PUBLISHED };

let KEY_JSON: string;
let PUBLIC_KEY: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  PUBLIC_KEY = pair.publicKey;
  const pkcs8 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))));
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  KEY_JSON = JSON.stringify({ type: "service_account", client_email: "reader@example-project.iam.gserviceaccount.com", private_key: pem });
});

const conn = (options: Record<string, string | number> = { domain: "example.com" }, apiKey?: string) => ({
  url: "",
  apiKey: apiKey ?? KEY_JSON,
  options,
});

type Call = { url: string; init: RequestInit };
type Fixture = { request: { startDate: string; endDate: string }; status: number; response: unknown };

/** Answers the token exchange, then each searchAnalytics query with the fixture whose window it asks for. */
function stub(fixtures: Fixture[], token: { status?: number; body?: unknown } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify(token.body ?? { access_token: "tok-1", expires_in: 3600, token_type: "Bearer" }), { status: token.status ?? 200 });
      }
      const asked = JSON.parse(String(init.body)) as { startDate: string; endDate: string };
      const hit = fixtures.find((f) => f.request.startDate === asked.startDate && f.request.endDate === asked.endDate);
      if (!hit) return new Response(JSON.stringify({ error: { message: `no fixture for ${asked.startDate}..${asked.endDate}` } }), { status: 500 });
      return new Response(JSON.stringify(hit.response), { status: hit.status });
    }),
  );
  return calls;
}

const queries = (calls: Call[]) => calls.filter((c) => c.url.includes("searchAnalytics"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Search Console Analytics Adapter: declaration", () => {
  it("measures a page by its public URL, reports after about three days, on contract 2", () => {
    expect(searchConsoleAnalytics).toMatchObject({ id: "search-console", contractVersion: 2, needs: "url", earliestDelayMs: 3 * 86_400_000 });
    expect(manifest.collect).toEqual(["3d", "7d", "28d"]);
  });

  it("declares clicks as the main metric, impressions, a derived CTR and a position where lower is better", () => {
    expect(manifest.metrics.map((m) => m.key)).toEqual(["clicks", "impressions", "ctr", "position"]);
    expect(manifest.primary).toBe("clicks");
    expect(manifest.metrics.find((m) => m.key === "ctr")).toMatchObject({ type: "level", format: "percent", derive: { sum: ["clicks"], per: "impressions" } });
    expect(manifest.metrics.find((m) => m.key === "position")).toMatchObject({ type: "level", better: "lower" });
    expect(manifest.metrics.find((m) => m.key === "clicks")).toMatchObject({ type: "counter" });
  });

  it("takes a service account key as a JSON secret and no connection URL", () => {
    expect(manifest.needsUrl).toBe(false);
    expect(manifest.secret).toEqual({ label: expect.any(String), kind: "json", fields: ["client_email", "private_key"] });
  });

  it("takes the domain as an option and maps the service labels to declared stored metrics only", () => {
    expect(manifest.options.map((o) => o.key)).toEqual(["domain"]);
    const stored = manifest.metrics.filter((m) => !("derive" in m)).map((m) => m.key);
    for (const metric of Object.values(metricsData.labels)) expect(stored).toContain(metric);
    expect(metricsData).not.toHaveProperty("kind");
  });
});

describe("Search Console Analytics Adapter: reading", () => {
  it("reads cumulative clicks and impressions since publication and the position over the last 7 final days", async () => {
    const calls = stub([cumulative, position7d]);
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: true, reading: { status: "taken", metrics: { clicks: 40, impressions: 7911, position: position7d.response.rows[0]!.position } } });

    // The two queries are exactly the recorded requests: same window, page filter, final data.
    const sent = queries(calls).map((c) => JSON.parse(String(c.init.body)));
    expect(sent).toEqual([cumulative.request, position7d.request]);
    expect(queries(calls)[0]!.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect((queries(calls)[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("reduces what is typed to the domain: a pasted URL or the sc-domain form give the same property", async () => {
    for (const typed of ["example.com", "https://www.example.com/blog/", "sc-domain:Example.com", " EXAMPLE.com "]) {
      const calls = stub([cumulative, position7d]);
      const result = await searchConsoleAnalytics.read(conn({ domain: typed }), REQUEST);
      expect(result.ok).toBe(true);
      expect(queries(calls)[0]!.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    }
  });

  it("reads an http page address as https, the address Search Console knows", async () => {
    const calls = stub([cumulative, position7d]);
    const result = await searchConsoleAnalytics.read(conn(), { ...REQUEST, url: REQUEST.url!.replace("https://", "http://") });
    expect(result.ok).toBe(true);
    const sent = queries(calls).map((c) => JSON.parse(String(c.init.body)));
    expect(sent).toEqual([cumulative.request, position7d.request]);
  });

  it("falls back to the http address when Search Console has no row for the https one", async () => {
    const httpUrl = REQUEST.url!.replace("https://", "http://");
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: RequestInit = {}) => {
        if (String(url) === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
        const page = (JSON.parse(String(init.body)) as { dimensionFilterGroups: { filters: { expression: string }[] }[] }).dimensionFilterGroups[0]!.filters[0]!.expression;
        asked.push(page);
        return new Response(JSON.stringify(page === httpUrl ? cumulative.response : unknownPage.response), { status: 200 });
      }),
    );
    const result = await searchConsoleAnalytics.read(conn(), { ...REQUEST, url: httpUrl });
    expect(result.ok).toBe(true);
    // https first (no row), then the address as given; the position read keeps the page that answered.
    expect(asked.slice(0, 2)).toEqual([REQUEST.url, httpUrl]);
    expect(asked.at(-1)).toBe(httpUrl);
  });

  it("starts the position window on the publication day when the page is younger than 7 final days", async () => {
    const calls = stub([
      { ...cumulative, request: { ...cumulative.request, startDate: "2026-11-14" } },
      { ...position7d, request: { ...position7d.request, startDate: "2026-11-14" } },
    ]);
    const result = await searchConsoleAnalytics.read(conn(), { url: PAGE, publishedAt: Date.parse("2026-11-14T12:00:00Z") });
    expect(result.ok).toBe(true);
    expect(queries(calls).map((c) => JSON.parse(String(c.init.body)).startDate)).toEqual(["2026-11-14", "2026-11-14"]);
  });

  it("answers no data yet, without asking, while no final day exists since publication", async () => {
    const calls = stub([]);
    const result = await searchConsoleAnalytics.read(conn(), { url: PAGE, publishedAt: Date.parse("2026-11-17T12:00:00Z") });
    expect(result).toEqual({ ok: true, reading: { status: "no_data" } });
    expect(queries(calls)).toHaveLength(0);
  });

  it("treats an answer with no rows as no data yet, not an error (a page the service does not know)", async () => {
    stub([unknownPage]);
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: true, reading: { status: "no_data" } });
  });

  it("treats a range with no finalized data as no data yet", async () => {
    stub([{ ...futureRange, request: { ...futureRange.request, startDate: cumulative.request.startDate, endDate: cumulative.request.endDate } }]);
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: true, reading: { status: "no_data" } });
  });

  it("keeps the totals without a position when the last 7 days have no row", async () => {
    stub([cumulative, { ...position7d, response: { responseAggregationType: "byPage" } }]);
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: true, reading: { status: "taken", metrics: { clicks: 40, impressions: 7911 } } });
  });
});

describe("Search Console Analytics Adapter: service account sign-in", () => {
  it("signs an RS256 JWT for the read-only scope and exchanges it with the jwt-bearer grant", async () => {
    const calls = stub([cumulative, position7d]);
    await searchConsoleAnalytics.read(conn(), REQUEST);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [head, claims, signature] = form.get("assertion")!.split(".") as [string, string, string];
    const decode = (part: string) => atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    expect(JSON.parse(decode(head))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(decode(claims))).toEqual({
      iss: "reader@example-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 3600,
    });
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", PUBLIC_KEY, Uint8Array.from(decode(signature), (c) => c.charCodeAt(0)), new TextEncoder().encode(`${head}.${claims}`));
    expect(valid).toBe(true);
  });

  it("refuses a key that is not JSON, with the reason, without calling out", async () => {
    const calls = stub([]);
    const result = await searchConsoleAnalytics.read(conn(undefined, "not json"), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(calls).toHaveLength(0);
  });

  it("refuses a key without client_email or private_key, naming the field", async () => {
    stub([]);
    const result = await searchConsoleAnalytics.read(conn(undefined, JSON.stringify({ client_email: "a@example.com" })), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/private_key/) });
  });

  it("refuses a private key that cannot be read", async () => {
    stub([]);
    const key = JSON.stringify({ client_email: "a@example.com", private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" });
    const result = await searchConsoleAnalytics.read(conn(undefined, key), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/private key/i) });
  });

  it("reports the reason Google gives when the token is refused", async () => {
    stub([], { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } });
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/invalid_grant.*Invalid JWT Signature/) });
  });
});

describe("Search Console Analytics Adapter: errors", () => {
  it("asks for the domain when none is set", async () => {
    const calls = stub([]);
    const result = await searchConsoleAnalytics.read(conn({}), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/domain/i) });
    expect(calls).toHaveLength(0);
  });

  it("needs the page URL of the Publication", async () => {
    stub([]);
    const result = await searchConsoleAnalytics.read(conn(), { publishedAt: PUBLISHED });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/URL/) });
  });

  it("explains a 403: the service account is not a user of the property, or the API is not enabled", async () => {
    stub([{ request: cumulative.request, status: 403, response: { error: { message: "User does not have sufficient permission for site" } } }]);
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/403/);
    expect(!result.ok && result.error).toMatch(/sufficient permission/);
    expect(!result.ok && result.error).toMatch(/Users and permissions/);
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/offline/) });
  });

  it("reports an unreadable answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("<html>", { status: 200 })));
    const result = await searchConsoleAnalytics.read(conn(), REQUEST);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/unreadable/) });
  });
});
