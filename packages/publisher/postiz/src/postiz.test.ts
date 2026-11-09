import { afterEach, describe, expect, it, vi } from "vitest";
import { postizManifest, postizPlugin as postizAdapter } from "./postiz";

// Optional Publishable fields forwarded to Postiz (ADR-069 amendment): Postiz is
// stubbed at fetch; we observe the body of the `posts` call.

const CONN = { url: "https://postiz.example.com", apiKey: "k" };

function stub() {
  const calls: Array<{ path: string; body: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url).split("/api/public/v1/")[1]!;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "upload-from-url") {
        return new Response(JSON.stringify({ id: `id-${calls.length}`, path: body.url }), { status: 200 });
      }
      return new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 });
    }),
  );
  return calls;
}
const post = (calls: ReturnType<typeof stub>) => calls.find((c) => c.path === "posts")!.body.posts[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Postiz adapter: optional Publishable fields", () => {
  it("forwards link to Pinterest", async () => {
    const calls = stub();
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "pinterest", settings: { board: "b" },
      publishable: { kind: "image", imageUrl: "https://x.test/i.png", caption: "c", link: "https://x.test/dest" },
    });
    expect(res.ok).toBe(true);
    expect(post(calls).settings).toMatchObject({ __type: "pinterest", board: "b", link: "https://x.test/dest" });
  });

  it("sends altText as alt on every image of an image or carousel, not on videos", async () => {
    let calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "carousel", slideUrls: ["https://x.test/1.png", "https://x.test/2.png"], caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image.map((i: any) => i.alt)).toEqual(["A cat", "A cat"]);

    calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "video", videoUrl: "https://x.test/v.mp4", caption: "c", altText: "A cat" },
    });
    expect(post(calls).value[0].image[0]).not.toHaveProperty("alt");
  });

  it("forwards tags and the cover as thumbnail to YouTube", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "youtube",
      publishable: {
        kind: "video", videoUrl: "https://x.test/v.mp4", coverUrl: "https://x.test/c.png", title: "T", caption: "c", tags: ["a", "b"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url").map((c) => c.body.url)).toEqual([
      "https://x.test/v.mp4", "https://x.test/c.png",
    ]);
    expect(post(calls).value[0].image).toHaveLength(1);
    expect(post(calls).settings).toMatchObject({
      __type: "youtube", title: "T",
      tags: [{ value: "a", label: "a" }, { value: "b", label: "b" }],
      thumbnail: { path: "https://x.test/c.png" },
    });
  });

  it("silently ignores link, tags and cover where Postiz has no equivalent", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok",
      publishable: {
        kind: "video", videoUrl: "https://x.test/v.mp4", coverUrl: "https://x.test/c.png", caption: "c", link: "https://x.test/d", tags: ["a"],
      },
    });
    expect(calls.filter((c) => c.path === "upload-from-url")).toHaveLength(1);
    const settings = post(calls).settings;
    expect(settings).not.toHaveProperty("link");
    expect(settings).not.toHaveProperty("tags");
    expect(settings).not.toHaveProperty("thumbnail");
  });
});

describe("Postiz adapter: connection URL", () => {
  it("requests exactly <host>/api/public/v1/... when the URL has trailing slashes", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ connected: true }), { status: 200 });
      }),
    );
    const res = await postizAdapter.testConnection({ url: "https://postiz.example.com//", apiKey: "k" });
    expect(res).toEqual({ ok: true });
    expect(urls).toEqual(["https://postiz.example.com/api/public/v1/is-connected"]);
  });
});

describe("Postiz adapter: media Postiz cannot fetch itself", () => {
  const publishVideo = (videoUrl: string) =>
    postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "video", videoUrl, caption: "c" },
    });

  function stubBytes() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, init });
        if (!u.includes("/api/public/v1/")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (u.endsWith("/upload")) return new Response(JSON.stringify({ id: "up-1", path: "https://postiz.example.com/u/v.mp4" }), { status: 200 });
        return new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 });
      }),
    );
    return calls;
  }

  it("downloads and sends the bytes when the URL is local, with the extension from the content type", async () => {
    const calls = stubBytes();
    const res = await publishVideo("http://localhost:4600/videos/run-1/final");
    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toBe("http://localhost:4600/videos/run-1/final");
    const upload = calls.find((c) => c.url.endsWith("/upload"))!;
    expect(upload.init?.body).toBeInstanceOf(FormData);
    expect(((upload.init!.body as FormData).get("file") as File).name).toBe("final.mp4");
    expect(calls.some((c) => c.url.endsWith("/upload-from-url"))).toBe(false);
  });

  it("downloads a public HTTPS URL that has no supported extension", async () => {
    const calls = stubBytes();
    expect((await publishVideo("https://mcp.example.com/videos/run-1/final")).ok).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/upload"))).toBe(true);
  });

  it("lets Postiz fetch a public HTTPS URL with an extension", async () => {
    const calls = stub();
    expect((await publishVideo("https://mcp.example.com/v/final.mp4")).ok).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["upload-from-url", "posts"]);
  });

  it("fails with a readable error when the local media cannot be downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const res = await publishVideo("http://localhost:4600/videos/run-1/final");
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("it responded 404");
  });
});

describe("Postiz adapter: postUrl", () => {
  it("is the template of the Postiz preview page of a post", () => {
    expect(postizAdapter.postUrl).toBe("{url}/p/{id}");
  });
});

describe("Postiz manifest", () => {
  it("is the plugin's identity", () => {
    expect(postizManifest).toMatchObject({ id: "postiz", name: "Postiz", contractVersion: 1 });
    expect(postizAdapter.id).toBe(postizManifest.id);
    expect(postizAdapter.contractVersion).toBe(postizManifest.contractVersion);
  });
});

describe("Postiz adapter: review fixes", () => {
  it("matches a caption with literal brackets against its HTML copy, and not the reverse", async () => {
    const { sameCaption } = await import("./postiz");
    expect(sameCaption("<p>x &lt; y &gt; z</p>", "x < y > z")).toBe(true);
    expect(sameCaption("x < y > z", "x < y > z")).toBe(true);
    expect(sameCaption("<p>a &amp;lt; b</p>", "a &lt; b")).toBe(true);
    expect(sameCaption("<p>x z</p>", "x < y > z")).toBe(false);
  });

  it("refuses a carousel with an invalid slide", async () => {
    stub();
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "instagram",
      publishable: { kind: "carousel", slideUrls: [null, 42], caption: "c" },
    });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("missing media reference") });
  });

  it("checks the Pinterest board before uploading anything", async () => {
    const calls = stub();
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "pinterest",
      publishable: { kind: "image", imageUrl: "https://x.test/i.png", caption: "c" },
    });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("keeps the real __type, sends YouTube's visibility and a title from the caption", async () => {
    const calls = stub();
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "youtube", settings: { __type: "instagram" },
      publishable: { kind: "video", videoUrl: "https://x.test/v.mp4", caption: "\nFirst line\nmore" },
    });
    expect(res.ok).toBe(true);
    expect(post(calls).settings).toMatchObject({ __type: "youtube", type: "public", title: "First line" });
  });

  it("sends duet and stitch as booleans on a TikTok photo post (Postiz answers 400 without them) and autoAddMusic only there", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok",
      publishable: { kind: "carousel", slideUrls: ["https://x.test/1.png", "https://x.test/2.png"], caption: "c" },
    });
    expect(post(calls).settings).toMatchObject({ duet: false, stitch: false, autoAddMusic: "no" });
    const video = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok", settings: { autoAddMusic: "yes" },
      publishable: { kind: "video", videoUrl: "https://x.test/v.mp4", caption: "c" },
    });
    const settings = post(video).settings;
    expect(settings).toMatchObject({ duet: true, stitch: true });
    expect(settings).not.toHaveProperty("autoAddMusic");
  });

  it("keeps a stored duet or stitch, and replaces one that is not a boolean", async () => {
    const calls = stub();
    await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "tiktok", settings: { duet: true, stitch: "yes" },
      publishable: { kind: "image", imageUrl: "https://x.test/i.png", caption: "c" },
    });
    expect(post(calls).settings).toMatchObject({ duet: true, stitch: false });
  });

  it("returns an error, not an exception, for a media URL with a stray '%'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      if (String(url).startsWith("http://localhost:3000/")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
      }
      if (String(url).endsWith("/posts")) return new Response(JSON.stringify([{ postId: "p1" }]), { status: 200 });
      return new Response(JSON.stringify({ id: "u", path: "/u.png" }), { status: 200 });
    }));
    const res = await postizAdapter.publish(CONN, {
      channelId: "c", channelService: "pinterest", settings: { board: "b" },
      publishable: { kind: "image", imageUrl: "http://localhost:3000/media/100%off.png", caption: "c" },
    });
    expect(res).toMatchObject({ ok: true });
  });

  it("never downloads from a link-local host, even through a redirect", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      fetched.push(String(url));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/x.png" } });
    }));
    for (const imageUrl of ["http://169.254.169.254/latest/x.png", "http://localhost:3000/r.png"]) {
      const res = await postizAdapter.publish(CONN, {
        channelId: "c", channelService: "pinterest", settings: { board: "b" },
        publishable: { kind: "image", imageUrl, caption: "c" },
      });
      expect(res).toMatchObject({ ok: false, error: expect.stringContaining("not allowed") });
    }
    expect(fetched).toEqual(["http://localhost:3000/r.png"]);
  });

  it("refuses a non-media download and a media over the size limit", async () => {
    const { MAX_MEDIA_BYTES } = await import("./postiz");
    const cases: Array<Record<string, string>> = [{ "content-type": "application/json" }, { "content-type": "video/mp4", "content-length": String(MAX_MEDIA_BYTES + 1) }];
    for (const headers of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers })));
      const res = await postizAdapter.publish(CONN, {
        channelId: "c", channelService: "pinterest", settings: { board: "b" },
        publishable: { kind: "image", imageUrl: "http://localhost:3000/x", caption: "c" },
      });
      expect(res.ok).toBe(false);
    }
  });

  it("finds a post outside the window around its scheduled date before declaring it gone", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      queries.push(String(url));
      const posts = queries.length === 1 ? [] : [{ id: "p1", state: "QUEUE" }];
      return new Response(JSON.stringify({ posts }), { status: 200 });
    }));
    const res = await postizAdapter.getStatus(CONN, "p1");
    expect(res).toEqual({ ok: true, post: { status: "scheduled" } });
    expect(queries).toHaveLength(2);
  });
});
