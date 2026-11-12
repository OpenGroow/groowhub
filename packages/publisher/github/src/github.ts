import capabilitiesData from "../data/capabilities.json";
import channelOptionsData from "../data/channel-options.json";
import manifestData from "../manifest.json";
import type {
  CapabilitiesData,
  ChannelOptionsData,
  PostStatus,
  PublisherChannel,
  PublisherConnection,
  PublisherPlugin,
  PublisherResult,
} from "@opengroow/publisher-sdk";

// The GitHub Publisher (ADR-074): a channel is one repository the token can
// push to; publishing an `article` is one commit adding its markdown page and
// its cover. GitHub has no scheduling and no idempotency key: a file already at
// the article's path is never overwritten, and on a retry it is how a lost
// attempt is found again (`findPost`).

const API = "https://api.github.com";
const MAX_COVER_BYTES = 20 * 1024 * 1024;
/** Commits built again when the branch moves between reading it and moving it. */
const MAX_ATTEMPTS = 3;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The REST API base: the connection URL, `github.com` meaning the public API. */
function apiBase(conn: PublisherConnection): string {
  const url = conn.url.trim().replace(/\/+$/, "");
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host === "www.github.com") return API;
  } catch {
    // Not a URL: the core validates it on save; let the request fail.
  }
  return url;
}

type Answer = { status: number; body: unknown };

/** One API call. Only a network failure is a failed result: every HTTP answer is returned with its status. */
async function call(conn: PublisherConnection, method: string, path: string, json?: unknown): Promise<PublisherResult<{ answer: Answer }>> {
  let response: Response;
  try {
    response = await fetch(`${apiBase(conn)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (error) {
    return { ok: false, uncertain: true, error: `Could not reach GitHub: ${messageOf(error)}` };
  }
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: true, answer: { status: response.status, body } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A refusal by GitHub, as a message. A 5xx (or 408) does not prove GitHub did not act: `uncertain`. */
function refusal(answer: Answer): { ok: false; error: string; uncertain?: true } {
  const hint = answer.status === 401 || answer.status === 403 ? " (check the token)" : "";
  const message = (answer.body as { message?: unknown } | null)?.message;
  const detail = typeof message === "string" && message ? `: ${message.replace(/\s+/g, " ").slice(0, 300)}` : "";
  const uncertain = answer.status >= 500 || answer.status === 408;
  return { ok: false, error: `GitHub responded ${answer.status}${hint}${detail}`, ...(uncertain ? { uncertain: true as const } : {}) };
}

/** A call whose only acceptable answers are 2xx; anything else is a failure. */
async function expectOk(conn: PublisherConnection, method: string, path: string, json?: unknown): Promise<PublisherResult<{ body: unknown }>> {
  const res = await call(conn, method, path, json);
  if (!res.ok) return res;
  if (res.answer.status < 200 || res.answer.status >= 300) return refusal(res.answer);
  return { ok: true, body: res.answer.body };
}

const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function repoPath(channelId: string): PublisherResult<{ path: string }> {
  const parts = channelId.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: `"${channelId}" is not a GitHub repository (owner/repo)` };
  return { ok: true, path: `/repos/${segments(channelId)}` };
}

type Layout = { branch?: string; contentBase: string; coverBase: string; publicBase: string; articleBaseUrl: string };

/** The channel options: where the article and its cover go, and where the site shows them. */
function layoutOf(settings: Record<string, unknown> | undefined): PublisherResult<{ layout: Layout }> {
  const text = (key: string) => (typeof settings?.[key] === "string" ? (settings[key] as string).trim() : "");
  const missing = ["contentBase", "coverBase", "publicBase", "articleBaseUrl"].filter((key) => text(key) === "");
  if (missing.length > 0) {
    return { ok: false, error: `Set ${missing.join(", ")} on this GitHub channel (Publishers page)` };
  }
  const folder = (key: string) => text(key).replace(/^\/+|\/+$/g, "");
  return {
    ok: true,
    layout: {
      ...(text("branch") ? { branch: text("branch") } : {}),
      contentBase: folder("contentBase"),
      coverBase: folder("coverBase"),
      publicBase: text("publicBase").replace(/\/+$/, ""),
      articleBaseUrl: text("articleBaseUrl").replace(/\/+$/, ""),
    },
  };
}

const join = (base: string, name: string) => (base ? `${base}/${name}` : name);
const contentPathOf = (layout: Layout, slug: string) => join(layout.contentBase, `${slug}.md`);
const articleUrlOf = (layout: Layout, slug: string) => `${layout.articleBaseUrl}/${slug}`;

/** The branch to commit to: the channel's, else the repository's default branch. */
async function branchOf(conn: PublisherConnection, repo: string, layout: Layout): Promise<PublisherResult<{ branch: string }>> {
  if (layout.branch) return { ok: true, branch: layout.branch };
  const res = await expectOk(conn, "GET", repo);
  if (!res.ok) return { ok: false, error: res.error };
  const branch = (res.body as { default_branch?: unknown } | null)?.default_branch;
  return typeof branch === "string" && branch ? { ok: true, branch } : { ok: false, error: "GitHub did not give the repository's default branch" };
}

/** Whether a file is at `path` on `branch`. */
async function fileExists(conn: PublisherConnection, repo: string, path: string, branch: string): Promise<PublisherResult<{ exists: boolean }>> {
  const res = await call(conn, "GET", `${repo}/contents/${segments(path)}?ref=${encodeURIComponent(branch)}`);
  if (!res.ok) return { ok: false, error: res.error };
  if (res.answer.status === 404) return { ok: true, exists: false };
  if (res.answer.status >= 200 && res.answer.status < 300) return { ok: true, exists: true };
  const refused = refusal(res.answer);
  return { ok: false, error: refused.error };
}

type Article = { markdownUrl: string; coverUrl: string; slug: string; title: string; description: string; category?: string };

function articleOf(publishable: Record<string, unknown> | undefined): PublisherResult<{ article: Article }> {
  if (publishable?.kind !== "article") {
    return { ok: false, error: `GitHub publishes articles only, not ${publishable?.kind === undefined ? "this content" : `a "${String(publishable.kind)}"`}` };
  }
  const { markdownUrl, coverUrl, slug, title, description, category } = publishable;
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, error: "The article has no valid slug" };
  for (const [key, value] of Object.entries({ markdownUrl, coverUrl, title, description })) {
    if (typeof value !== "string" || value === "") return { ok: false, error: `The article has no ${key}` };
  }
  return {
    ok: true,
    article: {
      markdownUrl: markdownUrl as string,
      coverUrl: coverUrl as string,
      slug,
      title: title as string,
      description: description as string,
      ...(typeof category === "string" && category ? { category } : {}),
    },
  };
}

/** The markdown page: the fixed frontmatter, then the body the MCP serves (its own frontmatter, if any, replaced). */
function articleMarkdown(article: Article, layout: Layout, publishedAt: string, source: string): string {
  const quote = (value: string) => JSON.stringify(value); // a JSON string is a YAML double-quoted scalar
  const lines = [
    "---",
    `title: ${quote(article.title)}`,
    `description: ${quote(article.description)}`,
    `publishedAt: ${quote(publishedAt)}`,
    `cover: ${quote(`${layout.publicBase}/${article.slug}.webp`)}`,
    ...(article.category ? [`category: ${quote(article.category)}`] : []),
    "---",
  ];
  const body = source.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").replace(/^(?:[ \t]*\r?\n)+/, "");
  return `${lines.join("\n")}\n\n${body}`;
}

/** Reads a media of the MCP: a plain fetch, no key (ADR-074). */
async function fetchMedia(url: string): Promise<PublisherResult<{ response: Response }>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, error: `it responded ${response.status}` };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

async function fetchMarkdown(url: string): Promise<PublisherResult<{ text: string }>> {
  const res = await fetchMedia(url);
  if (!res.ok) return { ok: false, error: `Could not fetch the article markdown ${url}: ${res.error}` };
  try {
    return { ok: true, text: await res.response.text() };
  } catch (error) {
    return { ok: false, error: `Could not fetch the article markdown ${url}: ${messageOf(error)}` };
  }
}

async function fetchCover(url: string): Promise<PublisherResult<{ base64: string }>> {
  const res = await fetchMedia(url);
  if (!res.ok) return { ok: false, error: `cover not ready (${url}: ${res.error})` };
  const type = (res.response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "" && type !== "image/webp" && type !== "application/octet-stream") {
    return { ok: false, error: `The cover must be a WebP image, ${url} is "${type}"` };
  }
  try {
    const bytes = new Uint8Array(await res.response.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, error: `cover not ready (${url} is empty)` };
    if (bytes.byteLength > MAX_COVER_BYTES) return { ok: false, error: `The cover ${url} is too large` };
    return { ok: true, base64: toBase64(bytes) };
  } catch (error) {
    return { ok: false, error: `cover not ready (${url}: ${messageOf(error)})` };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function shaOf(body: unknown, field: "sha" | "object" | "tree"): string | undefined {
  const b = body as Record<string, unknown> | null;
  const value = field === "sha" ? b?.sha : (b?.[field] as { sha?: unknown } | undefined)?.sha;
  return typeof value === "string" && value ? value : undefined;
}

// manifest.json is the single source of the plugin's identity (ADR-072).
export const githubManifest = manifestData as { id: string; name: string; contractVersion: number; scheduling?: false; icon?: string };

export const githubPlugin: PublisherPlugin = {
  id: githubManifest.id,
  name: githubManifest.name,
  contractVersion: githubManifest.contractVersion,
  capabilities: capabilitiesData as CapabilitiesData,
  channelOptions: channelOptionsData as ChannelOptionsData,

  async testConnection(conn) {
    const res = await expectOk(conn, "GET", "/user");
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  },

  async listChannels(conn) {
    const channels: PublisherChannel[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await expectOk(conn, "GET", `/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`);
      if (!res.ok) return { ok: false, error: res.error };
      if (!Array.isArray(res.body)) return { ok: false, error: "GitHub returned an unexpected repository list" };
      for (const repo of res.body as Array<Record<string, unknown>>) {
        const name = repo?.full_name;
        if (typeof name !== "string" || (repo.permissions as { push?: unknown } | undefined)?.push !== true) continue;
        channels.push({ id: name, name, service: "github", profile: name });
      }
      if (res.body.length < 100) break;
    }
    return { ok: true, channels };
  },

  async publish(conn, request) {
    if (request.publishAt !== undefined) return { ok: false, error: "GitHub cannot schedule a post: publish it now" };
    const parsed = articleOf(request.publishable);
    if (!parsed.ok) return parsed;
    const { article } = parsed;
    const repo = repoPath(request.channelId);
    if (!repo.ok) return repo;
    const target = layoutOf(request.settings);
    if (!target.ok) return target;
    const { layout } = target;
    const branch = await branchOf(conn, repo.path, layout);
    if (!branch.ok) return branch;
    const contentPath = contentPathOf(layout, article.slug);
    const coverPath = join(layout.coverBase, `${article.slug}.webp`);

    const noOverwrite = async (): Promise<PublisherResult> => {
      const found = await fileExists(conn, repo.path, contentPath, branch.branch);
      if (!found.ok) return found;
      return found.exists ? { ok: false, error: `a file already exists at ${contentPath}` } : { ok: true };
    };
    const free = await noOverwrite();
    if (!free.ok) return free;

    // Read at commit time: the latest revision is the one published (ADR-074).
    const markdown = await fetchMarkdown(article.markdownUrl);
    if (!markdown.ok) return markdown;
    const cover = await fetchCover(article.coverUrl);
    if (!cover.ok) return cover;
    const publishedAt = new Date().toISOString();
    const page = articleMarkdown(article, layout, publishedAt, markdown.text);

    const blob = await expectOk(conn, "POST", `${repo.path}/git/blobs`, { content: cover.base64, encoding: "base64" });
    if (!blob.ok) return { ok: false, error: blob.error };
    const coverSha = shaOf(blob.body, "sha");
    if (!coverSha) return { ok: false, error: "GitHub returned an unexpected blob" };

    const ref = `${repo.path}/git/refs/heads/${segments(branch.branch)}`;
    let claimed = false;
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        const stillFree = await noOverwrite();
        if (!stillFree.ok) return stillFree;
      }
      const head = await expectOk(conn, "GET", `${repo.path}/git/ref/heads/${segments(branch.branch)}`);
      if (!head.ok) return { ok: false, error: head.error };
      const headSha = shaOf(head.body, "object");
      if (!headSha) return { ok: false, error: `GitHub did not give the head of ${branch.branch}` };
      const headCommit = await expectOk(conn, "GET", `${repo.path}/git/commits/${headSha}`);
      if (!headCommit.ok) return { ok: false, error: headCommit.error };
      const baseTree = shaOf(headCommit.body, "tree");
      if (!baseTree) return { ok: false, error: "GitHub returned an unexpected commit" };
      const tree = await expectOk(conn, "POST", `${repo.path}/git/trees`, {
        base_tree: baseTree,
        tree: [
          { path: contentPath, mode: "100644", type: "blob", content: page },
          { path: coverPath, mode: "100644", type: "blob", sha: coverSha },
        ],
      });
      if (!tree.ok) return { ok: false, error: tree.error };
      const treeSha = shaOf(tree.body, "sha");
      if (!treeSha) return { ok: false, error: "GitHub returned an unexpected tree" };
      const commit = await expectOk(conn, "POST", `${repo.path}/git/commits`, {
        message: `Publish ${article.slug}`,
        tree: treeSha,
        parents: [headSha],
      });
      if (!commit.ok) return { ok: false, error: commit.error };
      const commitSha = shaOf(commit.body, "sha");
      if (!commitSha) return { ok: false, error: "GitHub returned an unexpected commit" };

      // Moving the branch is what publishes: the core is asked once, right before.
      if (!claimed) {
        if (request.beforePost && !(await request.beforePost([]))) return { ok: false, error: "This Publication is already being sent" };
        claimed = true;
      }
      const moved = await call(conn, "PATCH", ref, { sha: commitSha, force: false });
      if (!moved.ok) return moved;
      const { status } = moved.answer;
      if (status >= 200 && status < 300) {
        return { ok: true, outcome: { externalId: commitSha, status: "published", externalUrl: articleUrlOf(layout, article.slug) } };
      }
      // 422: the branch moved since it was read; the commit is dropped and built again on the new head.
      if (status === 422 && attempt < MAX_ATTEMPTS) continue;
      if (status === 422) return { ok: false, error: `The branch ${branch.branch} kept moving while publishing: try again` };
      return refusal(moved.answer);
    }
  },

  // A retry after an uncertain send: the file at the article's path is the
  // post a lost attempt committed (a first send refuses an existing file).
  async findPost(conn, query) {
    const parsed = articleOf(query.publishable);
    if (!parsed.ok) return { ok: false, error: `Cannot look for the article: ${parsed.error}` };
    const repo = repoPath(query.channelId);
    if (!repo.ok) return repo;
    const target = layoutOf(query.settings);
    if (!target.ok) return target;
    const branch = await branchOf(conn, repo.path, target.layout);
    if (!branch.ok) return branch;
    const path = contentPathOf(target.layout, parsed.article.slug);
    const found = await fileExists(conn, repo.path, path, branch.branch);
    if (!found.ok) return found;
    if (!found.exists) return { ok: true, post: null };
    const commits = await expectOk(
      conn,
      "GET",
      `${repo.path}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch.branch)}&per_page=1`,
    );
    if (!commits.ok) return { ok: false, error: commits.error };
    const sha = Array.isArray(commits.body) ? shaOf(commits.body[0], "sha") : undefined;
    if (!sha) return { ok: false, error: `GitHub gave no commit for ${path}` };
    return { ok: true, post: { externalId: sha, status: "published", externalUrl: articleUrlOf(target.layout, parsed.article.slug) } };
  },

  // The commit names the article it added; the post is published while that file is on the branch.
  async getStatus(conn, externalId, _around, target) {
    if (!target) return { ok: false, error: "GitHub needs the channel to read the status of a commit" };
    const repo = repoPath(target.channelId);
    if (!repo.ok) return repo;
    const options = layoutOf(target.settings);
    if (!options.ok) return options;
    const { layout } = options;
    const res = await call(conn, "GET", `${repo.path}/commits/${encodeURIComponent(externalId)}`);
    if (!res.ok) return { ok: false, error: res.error };
    const gone = (error: string): PublisherResult<{ post: PostStatus }> => ({ ok: true, post: { status: "failed", error } });
    if (res.answer.status === 404 || res.answer.status === 422) return gone(`The commit ${externalId} no longer exists in ${target.channelId}`);
    if (res.answer.status < 200 || res.answer.status >= 300) return { ok: false, error: refusal(res.answer).error };
    const files = (res.answer.body as { files?: unknown } | null)?.files;
    const prefix = layout.contentBase ? `${layout.contentBase}/` : "";
    const added = (Array.isArray(files) ? files : [])
      .map((f) => (f as { filename?: unknown } | null)?.filename)
      .find((name): name is string => typeof name === "string" && name.startsWith(prefix) && name.endsWith(".md") && !name.slice(prefix.length).includes("/"));
    if (!added) return gone(`The commit ${externalId} carries no article under ${layout.contentBase || "the repository root"}`);
    const slug = added.slice(prefix.length, -".md".length);
    const branch = await branchOf(conn, repo.path, layout);
    if (!branch.ok) return branch;
    const found = await fileExists(conn, repo.path, added, branch.branch);
    if (!found.ok) return found;
    return found.exists
      ? { ok: true, post: { status: "published", externalUrl: articleUrlOf(layout, slug) } }
      : gone(`The article ${added} is no longer on ${branch.branch}`);
  },
};
