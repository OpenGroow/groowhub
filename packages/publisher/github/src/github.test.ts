import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubManifest, githubPlugin } from "./github";

// The GitHub Publisher (ADR-074) against a fake GitHub behind a stubbed fetch:
// one repository per channel, files per branch, the Git Data API calls a
// commit takes. The article's markdown and cover are served by a fake MCP.

const CONN = { url: "https://api.github.com", apiKey: "ghp_token" };
const MCP = "https://mcp.example.com";
// A blog-utils site in a monorepo: articles under apps/web/content/blog, covers served from apps/web/public/images/blog.
const SETTINGS = {
  siteFolder: "/apps/web/",
  coversPath: "images/blog/",
  articleBaseUrl: "https://example.com/blog/",
};
const ARTICLE = {
  kind: "article",
  markdownUrl: `${MCP}/articles/a1.md`,
  coverUrl: `${MCP}/articles/a1/cover.webp`,
  slug: "my-first-post",
  title: 'Hello "world"',
  description: "A first post",
  category: "news",
};
const COVER = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);

type Person = { name: string; email: string; date: string };
type Commit = { sha: string; parent?: string; files: Map<string, string>; date: string; author?: Person; committer?: Person };
type Fake = {
  repos: Array<{ full_name: string; default_branch: string; permissions: { push: boolean }; owner?: { avatar_url: string } }>;
  branches: Map<string, string>; // "<repo>@<branch>" -> head sha
  commits: Map<string, Commit>; // sha -> commit (its whole tree)
  trees: Map<string, Map<string, string>>;
  blobs: Map<string, string>;
  /** Answers PATCH .../git/refs/heads/<branch> instead of the fake. */
  refUpdate?: () => Response | Promise<Response>;
  markdown?: () => Response;
  cover?: () => Response;
  calls: Array<{ method: string; url: string; body?: any }>;
};

let fake: Fake;
let seq = 0;
const sha = () => `sha${++seq}`.padEnd(40, "0");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function seedRepo(full_name: string, files: Record<string, string> = {}, branch = "main") {
  // A new commit on top of the branch (or its first one).
  const head = sha();
  const parent = fake.branches.get(`${full_name}@${branch}`);
  fake.commits.set(head, { sha: head, ...(parent ? { parent } : {}), files: new Map(Object.entries(files)), date: "2026-01-01T00:00:00Z" });
  fake.branches.set(`${full_name}@${branch}`, head);
  if (!fake.repos.some((r) => r.full_name === full_name)) fake.repos.push({ full_name, default_branch: branch, permissions: { push: true } });
}

/** The files on a branch, base64 decoded as text (or raw base64 for the cover). */
function filesOn(repo: string, branch = "main"): Map<string, string> {
  return fake.commits.get(fake.branches.get(`${repo}@${branch}`)!)!.files;
}

async function handle(url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  fake.calls.push({ method, url: url.toString(), body });
  if (url.origin === MCP) {
    if (url.pathname.endsWith(".md")) return fake.markdown?.() ?? new Response("# Hello\n\nBody text.\n", { headers: { "content-type": "text/markdown" } });
    return fake.cover?.() ?? new Response(COVER, { headers: { "content-type": "image/webp" } });
  }
  expect(url.origin).toBe("https://api.github.com");
  expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ghp_token");
  const path = decodeURIComponent(url.pathname);
  if (path === "/user") return json({ login: "octo", id: 42, name: "Octo Cat" });
  if (path === "/user/repos") {
    const page = Number(url.searchParams.get("page") ?? "1");
    return json(page === 1 ? fake.repos : []);
  }
  const m = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  if (!m) return json({ message: "Not Found" }, 404);
  const repo = m[1]!;
  const rest = m[2] ?? "";
  const meta = fake.repos.find((r) => r.full_name === repo);
  if (!meta) return json({ message: "Not Found" }, 404);
  if (rest === "") return json(meta);
  let r: RegExpMatchArray | null;
  if ((r = rest.match(/^\/contents\/(.+)$/))) {
    const head = fake.branches.get(`${repo}@${url.searchParams.get("ref") ?? meta.default_branch}`);
    const content = head ? fake.commits.get(head)!.files.get(r[1]!) : undefined;
    return content === undefined ? json({ message: "Not Found" }, 404) : json({ path: r[1], sha: "blob" });
  }
  if ((r = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
    const head = fake.branches.get(`${repo}@${r[1]}`);
    return head ? json({ object: { sha: head } }) : json({ message: "Not Found" }, 404);
  }
  if ((r = rest.match(/^\/git\/commits\/(.+)$/))) return json({ sha: r[1], tree: { sha: `tree-of-${r[1]}` } });
  if (rest === "/git/blobs" && method === "POST") {
    const s = sha();
    fake.blobs.set(s, body.content);
    return json({ sha: s }, 201);
  }
  if (rest === "/git/trees" && method === "POST") {
    const base = fake.commits.get(String(body.base_tree).replace("tree-of-", ""))!;
    const files = new Map(base.files);
    for (const entry of body.tree) files.set(entry.path, entry.content !== undefined ? entry.content : fake.blobs.get(entry.sha)!);
    const s = `tree-${sha()}`;
    fake.trees.set(s, files);
    return json({ sha: s }, 201);
  }
  if (rest === "/git/commits" && method === "POST") {
    const s = sha();
    const date = body.committer?.date ?? "2026-11-12T10:00:00Z";
    fake.commits.set(s, { sha: s, parent: body.parents[0], files: fake.trees.get(body.tree)!, date, author: body.author, committer: body.committer });
    return json({ sha: s, committer: { date } }, 201);
  }
  if ((r = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
    if (fake.refUpdate) return fake.refUpdate();
    const key = `${repo}@${r[1]}`;
    const commit = fake.commits.get(body.sha)!;
    if (commit.parent !== fake.branches.get(key)) return json({ message: "Update is not a fast forward" }, 422);
    fake.branches.set(key, body.sha);
    return json({ object: { sha: body.sha } });
  }
  if (rest === "/commits") {
    // The commits of a branch that touch a path, newest first.
    const wanted = url.searchParams.get("path")!;
    const out: string[] = [];
    for (let s: string | undefined = fake.branches.get(`${repo}@${url.searchParams.get("sha")}`); s; ) {
      const c = fake.commits.get(s)!;
      const before = c.parent ? fake.commits.get(c.parent)!.files.get(wanted) : undefined;
      if (c.files.get(wanted) !== before) out.push(c.sha);
      s = c.parent;
    }
    return json(out.map((s) => ({ sha: s, commit: { committer: { date: fake.commits.get(s)!.date } } })));
  }
  if ((r = rest.match(/^\/commits\/(.+)$/))) {
    const c = fake.commits.get(r[1]!);
    if (!c) return json({ message: "No commit found" }, 422);
    const parent = c.parent ? fake.commits.get(c.parent)!.files : new Map();
    const files = [...c.files.keys()].filter((p) => parent.get(p) !== c.files.get(p)).map((filename) => ({ filename }));
    return json({ sha: c.sha, files });
  }
  return json({ message: `unexpected ${method} ${path}` }, 500);
}

beforeEach(() => {
  seq = 0;
  fake = { repos: [], branches: new Map(), commits: new Map(), trees: new Map(), blobs: new Map(), calls: [] };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => handle(new URL(String(input)), init)));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const publish = (extra: Record<string, unknown> = {}) =>
  githubPlugin.publish(CONN, { channelId: "acme/site", channelService: "github", settings: SETTINGS, publishable: ARTICLE, ...extra });

describe("GitHub Publisher: manifest and data", () => {
  it("declares that it cannot schedule, and takes articles only", () => {
    expect(githubManifest).toMatchObject({ id: "github", name: "Blog Utils (GitHub)", scheduling: false });
    expect(githubPlugin.capabilities.platforms.github).toMatchObject({ article: "supported", video: "unsupported", image: "unsupported", carousel: "unsupported" });
    expect(githubPlugin.capabilities.platforms.github!.reasons?.video).toBe("a site repository takes articles");
    expect(githubPlugin.channelOptions.platforms.github!.map((o) => o.key)).toEqual(["branch", "siteFolder", "coversPath", "articleBaseUrl"]);
    // A blog-utils site always reads its articles from content/blog: only what differs between sites is asked.
    expect(githubPlugin.channelOptions.platforms.github!.filter((o) => o.type === "text" && o.required).map((o) => o.key)).toEqual(["coversPath", "articleBaseUrl"]);
    // The package icon is Blog Utils; the platform's logo, shown on the repository channels, is GitHub's.
    expect(githubManifest.icon).not.toBe(githubPlugin.capabilities.platforms.github!.icon);
  });
});

describe("GitHub Publisher: connection and channels", () => {
  it("checks the token", async () => {
    expect(await githubPlugin.testConnection(CONN)).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Bad credentials" }, 401)));
    const res = await githubPlugin.testConnection(CONN);
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toMatch(/401.*check the token/);
  });

  it("reads the API at api.github.com when the connection URL is github.com", async () => {
    expect(await githubPlugin.testConnection({ url: "https://github.com/", apiKey: "ghp_token" })).toEqual({ ok: true });
  });

  it("lists the repositories the token can push to, keyed by owner/repo", async () => {
    seedRepo("acme/site");
    fake.repos.push({ full_name: "acme/read-only", default_branch: "main", permissions: { push: false } });
    const res = await githubPlugin.listChannels(CONN);
    expect(res).toEqual({ ok: true, channels: [{ id: "acme/site", name: "acme/site", service: "github", profile: "acme/site" }] });
  });

  it("gives each repository its owner's avatar as picture", async () => {
    fake.repos.push({ full_name: "acme/blog", default_branch: "main", permissions: { push: true }, owner: { avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" } });
    fake.repos.push({ full_name: "acme/odd", default_branch: "main", permissions: { push: true }, owner: { avatar_url: "javascript:alert(1)" } });
    const res = await githubPlugin.listChannels(CONN);
    expect(res).toEqual({
      ok: true,
      channels: [
        { id: "acme/blog", name: "acme/blog", service: "github", profile: "acme/blog", picture: "https://avatars.githubusercontent.com/u/1?v=4" },
        { id: "acme/odd", name: "acme/odd", service: "github", profile: "acme/odd" },
      ],
    });
  });
});

describe("GitHub Publisher: publish", () => {
  beforeEach(() => seedRepo("acme/site", { "README.md": "readme" }));

  it("commits the article and its cover in one commit, with the fixed frontmatter", async () => {
    const res = await publish();
    expect(res).toEqual({
      ok: true,
      outcome: { externalId: fake.branches.get("acme/site@main"), status: "published", externalUrl: "https://example.com/blog/my-first-post" },
    });
    const files = filesOn("acme/site");
    expect(files.get("README.md")).toBe("readme");
    const markdown = files.get("apps/web/content/blog/my-first-post.md")!;
    const publishedAt = markdown.match(/^publishedAt: "(.+)"$/m)?.[1];
    expect(Number.isNaN(Date.parse(publishedAt!))).toBe(false);
    expect(markdown).toBe(
      [
        "---",
        'title: "Hello \\"world\\""',
        'description: "A first post"',
        `publishedAt: "${publishedAt}"`,
        'cover: "/images/blog/my-first-post.webp"',
        'category: "news"',
        "---",
        "",
        "# Hello",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
    expect(files.get("apps/web/public/images/blog/my-first-post.webp")).toBe(b64(COVER));
    // publishedAt is the commit's own date, by the token's account.
    const commit = fake.commits.get(fake.branches.get("acme/site@main")!)!;
    expect(commit.committer).toEqual({ name: "Octo Cat", email: "42+octo@users.noreply.github.com", date: publishedAt });
    expect(commit.author).toEqual(commit.committer);
    // One commit on top of the previous head.
    expect(fake.calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/commits"))).toHaveLength(1);
    // Media are read without a key (ADR-074).
    for (const call of fake.calls.filter((c) => c.url.startsWith(MCP))) expect(call.method).toBe("GET");
    const mediaInits = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith(MCP)).map(([, init]) => init);
    for (const init of mediaInits) expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("leaves out the category when the article has none, and replaces a frontmatter the markdown brings", async () => {
    const { category: _c, ...article } = ARTICLE;
    fake.markdown = () => new Response("---\ntitle: other\n---\nBody\n");
    await publish({ publishable: article });
    const markdown = filesOn("acme/site").get("apps/web/content/blog/my-first-post.md")!;
    expect(markdown).not.toContain("category");
    expect(markdown).not.toContain("title: other");
    expect(markdown.endsWith("---\n\nBody\n")).toBe(true);
  });

  it("commits to the branch of the channel options instead of the default branch", async () => {
    seedRepo("acme/site", { "README.md": "readme" }, "content");
    const res = await publish({ settings: { ...SETTINGS, branch: "content" } });
    expect(res.ok).toBe(true);
    expect(filesOn("acme/site", "content").has("apps/web/content/blog/my-first-post.md")).toBe(true);
    expect(filesOn("acme/site", "main").has("apps/web/content/blog/my-first-post.md")).toBe(false);
  });

  it("never overwrites: a file already at the content path fails the send, not uncertain", async () => {
    seedRepo("acme/site", { "apps/web/content/blog/my-first-post.md": "someone else's" });
    const before = fake.branches.get("acme/site@main");
    const res = await publish();
    expect(res).toEqual({ ok: false, error: "a file already exists at apps/web/content/blog/my-first-post.md" });
    expect(fake.branches.get("acme/site@main")).toBe(before);
  });

  it("fails with cover not ready when the cover cannot be fetched, before any commit", async () => {
    fake.cover = () => new Response("rendering", { status: 404 });
    const res = await publish();
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^cover not ready/) });
    expect((res as { uncertain?: boolean }).uncertain).toBeUndefined();
    expect(fake.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("fails clearly when the markdown cannot be fetched", async () => {
    fake.markdown = () => new Response("gone", { status: 500 });
    const res = await publish();
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/markdown/) });
    expect((res as { uncertain?: boolean }).uncertain).toBeUndefined();
  });

  it("refuses a publishAt: a commit cannot be scheduled", async () => {
    const res = await publish({ publishAt: Date.now() + 3_600_000 });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cannot schedule/) });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses anything but an article, and names a missing channel option", async () => {
    expect(await publish({ publishable: { kind: "image", imageUrl: "https://x/i.png" } })).toMatchObject({ ok: false, error: expect.stringMatching(/article/) });
    const { articleBaseUrl: _a, ...settings } = SETTINGS;
    expect(await publish({ settings })).toMatchObject({ ok: false, error: "Set URL of the articles on this channel (Publishers page)" });
  });

  it("asks the core right before moving the branch, and stops when another caller owns the Publication", async () => {
    const before = fake.branches.get("acme/site@main");
    const beforePost = vi.fn(async () => false);
    const res = await publish({ beforePost });
    expect(beforePost).toHaveBeenCalledWith([]);
    expect(res).toEqual({ ok: false, error: "This Publication is already being sent" });
    expect(fake.branches.get("acme/site@main")).toBe(before);
  });

  it("is uncertain when moving the branch fails without an answer", async () => {
    fake.refUpdate = () => json({ message: "boom" }, 502);
    const res = await publish();
    expect(res).toMatchObject({ ok: false, uncertain: true });
  });

  it("builds the commit again when the branch moved meanwhile, asking the core once", async () => {
    let moved = false;
    fake.refUpdate = () => {
      fake.refUpdate = undefined;
      moved = true;
      seedRepo("acme/site", { "README.md": "readme v2" });
      return json({ message: "Update is not a fast forward" }, 422);
    };
    const beforePost = vi.fn(async () => true);
    const res = await publish({ beforePost });
    expect(moved).toBe(true);
    expect(res.ok).toBe(true);
    expect(beforePost).toHaveBeenCalledTimes(1);
    expect(filesOn("acme/site").get("README.md")).toBe("readme v2");
    expect(filesOn("acme/site").has("apps/web/content/blog/my-first-post.md")).toBe(true);
  });
});

describe("GitHub Publisher: reconcile and status", () => {
  beforeEach(() => seedRepo("acme/site", { "README.md": "readme" }));
  const query = { channelId: "acme/site", caption: "", attemptStartedAt: 0, attemptDate: 0, channelService: "github", settings: SETTINGS, publishable: ARTICLE };

  it("finds nothing before the article was committed", async () => {
    expect(await githubPlugin.findPost(CONN, query)).toEqual({ ok: true, post: null });
  });

  it("attaches the file a lost attempt committed (retry of an uncertain send)", async () => {
    const sent = await publish();
    const commit = (sent as { outcome: { externalId: string } }).outcome.externalId;
    seedRepo("acme/site", { ...Object.fromEntries(filesOn("acme/site")), "OTHER.md": "later" });
    expect(await githubPlugin.findPost(CONN, query)).toEqual({
      ok: true,
      post: { externalId: commit, status: "published", externalUrl: "https://example.com/blog/my-first-post" },
    });
  });

  it("does not attach a file committed before the attempt: the send then fails on it", async () => {
    seedRepo("acme/site", { "apps/web/content/blog/my-first-post.md": "someone else's" });
    const attemptStartedAt = Date.parse("2026-06-01T00:00:00Z");
    expect(await githubPlugin.findPost(CONN, { ...query, attemptStartedAt, attemptDate: attemptStartedAt })).toEqual({ ok: true, post: null });
  });

  it("cannot check when GitHub fails to answer: uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "boom" }, 503)));
    expect(await githubPlugin.findPost(CONN, query)).toMatchObject({ ok: false, uncertain: true });
  });

  it("cannot reconcile without the article", async () => {
    expect((await githubPlugin.findPost(CONN, { ...query, publishable: undefined })).ok).toBe(false);
  });

  it("reports the post published while its file is on the branch, failed once removed", async () => {
    const sent = await publish();
    const commit = (sent as { outcome: { externalId: string } }).outcome.externalId;
    const target = { channelId: "acme/site", settings: SETTINGS };
    expect(await githubPlugin.getStatus(CONN, commit, undefined, target)).toEqual({
      ok: true,
      post: { status: "published", externalUrl: "https://example.com/blog/my-first-post" },
    });
    const files = new Map(filesOn("acme/site"));
    files.delete("apps/web/content/blog/my-first-post.md");
    seedRepo("acme/site", Object.fromEntries(files));
    expect(await githubPlugin.getStatus(CONN, commit, undefined, target)).toMatchObject({ ok: true, post: { status: "failed" } });
    expect(await githubPlugin.getStatus(CONN, "unknown".padEnd(40, "0"), undefined, target)).toMatchObject({ ok: true, post: { status: "failed" } });
  });

  it("needs the channel to read a status", async () => {
    expect((await githubPlugin.getStatus(CONN, "abc")).ok).toBe(false);
  });
});
