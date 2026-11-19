import { afterEach, describe, expect, it, vi } from "vitest";
import { postizAnalytics } from "./postiz-analytics";
import manifest from "../manifest.json";
import metricsData from "../data/metrics.json";
import instagram from "../fixtures/analytics-post-instagram.json";
import tiktok from "../fixtures/analytics-post-tiktok.json";

// Seam 4: the plugin contract. Postiz is stubbed at fetch with the answers the
// spike captured from a real instance (ADR-078, Consequences).

const CONN = { url: "https://postiz.example.com/", apiKey: "key-1" };
const REQUEST = { externalId: "cm-post-1", kind: "social" as const, publishedAt: Date.parse("2026-11-17T10:00:00Z") };

type Stubbed = { urls: string[]; headers: Array<Record<string, string>> };

/** Answers by path: `analytics/post/...` with `analytics`, `posts?...` with the listing. */
function stub(analytics: unknown, listing: unknown = { posts: [] }, status = 200): Stubbed {
  const seen: Stubbed = { urls: [], headers: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      seen.urls.push(String(url));
      seen.headers.push((init?.headers ?? {}) as Record<string, string>);
      const body = String(url).includes("/analytics/post/") ? analytics : listing;
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Postiz Analytics Adapter: declaration", () => {
  it("needs the Postiz post id and reports after an hour, on contract 2", () => {
    expect(postizAnalytics).toMatchObject({ id: "postiz", contractVersion: 2, needs: "externalId", earliestDelayMs: 3_600_000 });
  });

  it("declares its seven metrics in the order of the columns, views first as the main metric", () => {
    expect(manifest.metrics.map((m) => m.key)).toEqual(["views", "likes", "comments", "engagement", "reach", "shares", "saves"]);
    expect(manifest.primary).toBe("views");
  });

  it("derives engagement from interactions over views instead of reading it from Postiz", () => {
    const engagement = manifest.metrics.find((m) => m.key === "engagement");
    expect(engagement).toMatchObject({ type: "level", format: "percent", derive: { sum: ["likes", "comments", "shares", "saves"], per: "views" } });
    expect(Object.values(metricsData.labels)).not.toContain("engagement");
  });

  it("keeps the labels mapping free of a kind, every label mapping to a declared metric", () => {
    expect(metricsData).not.toHaveProperty("kind");
    const declared = manifest.metrics.map((m) => m.key);
    for (const metric of Object.values(metricsData.labels)) expect(declared).toContain(metric);
  });
});

describe("Postiz Analytics Adapter: reading", () => {
  it("maps an Instagram answer (six labels) to the social vocabulary, totals parsed from strings", async () => {
    stub(instagram);
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({
      ok: true,
      reading: { status: "taken", metrics: { views: 23, reach: 23, saves: 0, likes: 0, comments: 0, shares: 0 } },
    });
  });

  it("takes a TikTok answer as it is: no reach, no saves is normal", async () => {
    stub(tiktok);
    const result = await postizAnalytics.read(CONN, REQUEST);
    expect(result).toEqual({ ok: true, reading: { status: "taken", metrics: { views: 0, likes: 0, comments: 0, shares: 0 } } });
  });

  it("asks the public route with the Postiz post id, the API key and the look-back window", async () => {
    const seen = stub(instagram);
    await postizAnalytics.read(CONN, REQUEST);
    expect(seen.urls).toEqual(["https://postiz.example.com/api/public/v1/analytics/post/cm-post-1?date=7"]);
    expect(seen.headers[0]).toMatchObject({ Authorization: "key-1" });
    const seen30 = stub(instagram);
    await postizAnalytics.read({ ...CONN, options: { lookbackDays: 30 } }, REQUEST);
    expect(seen30.urls[0]).toMatch(/\?date=30$/);
  });

  it("ignores labels it does not know and keeps the latest day when several come back", async () => {
    stub([
      { label: "Impressions", percentageChange: 0, data: [{ total: "99", date: "2026-11-18" }] },
      {
        label: "Views",
        percentageChange: 0,
        data: [
          { total: "10", date: "2026-11-17" },
          { total: "146", date: "2026-11-18" },
        ],
      },
    ]);
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: true, reading: { status: "taken", metrics: { views: 146 } } });
  });

  it("drops a total that is not a number", async () => {
    stub([{ label: "Views", percentageChange: 0, data: [{ total: "n/a", date: "2026-11-18" }] }]);
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: true, reading: { status: "no_data" } });
  });
});

describe("Postiz Analytics Adapter: an empty answer", () => {
  it("is no data yet when the post is in the posts listing", async () => {
    const seen = stub([], { posts: [{ id: "cm-post-1", publishDate: "2026-11-17T10:00:00.000Z" }] });
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: true, reading: { status: "no_data" } });
    expect(seen.urls[1]).toMatch(/^https:\/\/postiz\.example\.com\/api\/public\/v1\/posts\?startDate=.*&endDate=/);
  });

  it("is an unknown post when the listing does not hold it", async () => {
    stub([], { posts: [{ id: "another-post" }] });
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({
      ok: true,
      reading: { status: "unavailable", reason: expect.stringMatching(/does not know this post/) },
    });
  });

  it("is a failed reading when the listing cannot be read", async () => {
    stub([], { message: "nope" }, 200);
    expect(await postizAnalytics.read(CONN, REQUEST)).toMatchObject({ ok: false });
  });
});

describe("Postiz Analytics Adapter: failures", () => {
  it("points at the API key on a 401", async () => {
    stub({ message: "Unauthorized" }, undefined, 401);
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: false, error: expect.stringMatching(/401.*API key/) });
  });

  it("reports an unreachable Postiz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: false, error: expect.stringMatching(/Could not reach Postiz: ECONNREFUSED/) });
  });

  it("reads an answer of `{ missing }` as no data yet, not as a failure", async () => {
    stub({ missing: true });
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: true, reading: { status: "no_data" } });
  });

  it("reports an answer that is not a list", async () => {
    stub({ unexpected: true });
    // The message says what the answer looked like, never its values.
    expect(await postizAnalytics.read(CONN, REQUEST)).toEqual({ ok: false, error: expect.stringMatching(/unexpected.*an object with the keys unexpected/) });
  });

  it("needs the post id", async () => {
    expect(await postizAnalytics.read(CONN, { kind: "social", publishedAt: 1 })).toEqual({ ok: false, error: expect.stringMatching(/post id/) });
  });
});
