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
import { articleMarkdown, articleOf } from "./article";
import { fetchCover, fetchMarkdown, messageOf } from "./media";
import { articleUrlOf, contentPathOf, coverPathOf, layoutOf, slugOfContentPath, type Layout } from "./settings";

// The GitHub Publisher (ADR-074): a channel is one repository the token can
// push to; publishing an `article` is one commit adding its markdown page and
// its cover. GitHub has no scheduling and no idempotency key: a file already at
// the article's path is never overwritten, and on a retry it is how a lost
// attempt is found again (`findPost`).

const API = "https://api.github.com";
/** Commits built again when the branch moves between reading it and moving it. */
const MAX_ATTEMPTS = 3;
/** Clock drift tolerated between OpenGroow and GitHub when matching a commit to an attempt. */
const MARGIN_MS = 120_000;

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

const isSuccess = (answer: Answer) => answer.status >= 200 && answer.status < 300;

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
  return isSuccess(res.answer) ? { ok: true, body: res.answer.body } : refusal(res.answer);
}

/** The string at `keys` in a response body (`stringAt(body, "object", "sha")`), or undefined. */
function stringAt(body: unknown, ...keys: string[]): string | undefined {
  let value = body;
  for (const key of keys) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/");

type Channel = { repo: string; layout: Layout };
type Located = Channel & { branch: string };

/** The repository API path and the layout of a channel. */
function channelOf(channelId: string, settings: Record<string, unknown> | undefined): PublisherResult<{ channel: Channel }> {
  const parts = channelId.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: `"${channelId}" is not a GitHub repository (owner/repo)` };
  const options = layoutOf(settings);
  if (!options.ok) return options;
  return { ok: true, channel: { repo: `/repos/${segments(channelId)}`, layout: options.layout } };
}

/** The channel and the branch it commits to: its own, else the repository's default branch. */
async function locate(conn: PublisherConnection, channelId: string, settings: Record<string, unknown> | undefined): Promise<PublisherResult<{ at: Located }>> {
  const res = channelOf(channelId, settings);
  if (!res.ok) return res;
  const { channel } = res;
  if (channel.layout.branch) return { ok: true, at: { ...channel, branch: channel.layout.branch } };
  const repo = await expectOk(conn, "GET", channel.repo);
  if (!repo.ok) return repo;
  const branch = stringAt(repo.body, "default_branch");
  return branch ? { ok: true, at: { ...channel, branch } } : { ok: false, error: "GitHub did not give the repository's default branch" };
}

/** Whether a file is at `path` on the branch. */
async function fileExists(conn: PublisherConnection, at: Located, path: string): Promise<PublisherResult<{ exists: boolean }>> {
  const res = await call(conn, "GET", `${at.repo}/contents/${segments(path)}?ref=${encodeURIComponent(at.branch)}`);
  if (!res.ok) return res;
  if (res.answer.status === 404) return { ok: true, exists: false };
  return isSuccess(res.answer) ? { ok: true, exists: true } : refusal(res.answer);
}

/** Who the commit is by: the token's account, under its GitHub noreply address. */
async function committerOf(conn: PublisherConnection): Promise<PublisherResult<{ name: string; email: string }>> {
  const res = await expectOk(conn, "GET", "/user");
  if (!res.ok) return res;
  const login = stringAt(res.body, "login");
  const id = (res.body as { id?: unknown } | null)?.id;
  if (!login || typeof id !== "number") return { ok: false, error: "GitHub did not say which account the token is" };
  return { ok: true, name: stringAt(res.body, "name") ?? login, email: `${id}+${login}@users.noreply.github.com` };
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

  // Nothing is published before the branch moves: every failure before it is a plain failure.
  async publish(conn, request) {
    if (request.publishAt !== undefined) return { ok: false, error: "GitHub cannot schedule a post: publish it now" };
    const parsed = articleOf(request.publishable);
    if (!parsed.ok) return parsed;
    const { article } = parsed;
    const located = await locate(conn, request.channelId, request.settings);
    if (!located.ok) return { ok: false, error: located.error };
    const { at } = located;
    const contentPath = contentPathOf(at.layout, article.slug);

    const noOverwrite = async (): Promise<PublisherResult> => {
      const found = await fileExists(conn, at, contentPath);
      if (!found.ok) return { ok: false, error: found.error };
      return found.exists ? { ok: false, error: `a file already exists at ${contentPath}` } : { ok: true };
    };
    const free = await noOverwrite();
    if (!free.ok) return free;

    const markdown = await fetchMarkdown(article.markdownUrl);
    if (!markdown.ok) return markdown;
    const cover = await fetchCover(article.coverUrl);
    if (!cover.ok) return cover;
    const committer = await committerOf(conn);
    if (!committer.ok) return { ok: false, error: committer.error };
    const blob = await expectOk(conn, "POST", `${at.repo}/git/blobs`, { content: cover.base64, encoding: "base64" });
    if (!blob.ok) return { ok: false, error: blob.error };
    const coverSha = stringAt(blob.body, "sha");
    if (!coverSha) return { ok: false, error: "GitHub returned an unexpected blob" };

    const ref = `heads/${segments(at.branch)}`;
    let claimed = false;
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        const stillFree = await noOverwrite();
        if (!stillFree.ok) return stillFree;
      }
      const head = await expectOk(conn, "GET", `${at.repo}/git/ref/${ref}`);
      if (!head.ok) return { ok: false, error: head.error };
      const headSha = stringAt(head.body, "object", "sha");
      if (!headSha) return { ok: false, error: `GitHub did not give the head of ${at.branch}` };
      const headCommit = await expectOk(conn, "GET", `${at.repo}/git/commits/${headSha}`);
      if (!headCommit.ok) return { ok: false, error: headCommit.error };
      const baseTree = stringAt(headCommit.body, "tree", "sha");
      if (!baseTree) return { ok: false, error: "GitHub returned an unexpected commit" };
      // publishedAt is the commit's date: written in the frontmatter and given to the commit.
      const publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const tree = await expectOk(conn, "POST", `${at.repo}/git/trees`, {
        base_tree: baseTree,
        tree: [
          { path: contentPath, mode: "100644", type: "blob", content: articleMarkdown(article, at.layout, publishedAt, markdown.text) },
          { path: coverPathOf(at.layout, article.slug), mode: "100644", type: "blob", sha: coverSha },
        ],
      });
      if (!tree.ok) return { ok: false, error: tree.error };
      const treeSha = stringAt(tree.body, "sha");
      if (!treeSha) return { ok: false, error: "GitHub returned an unexpected tree" };
      const person = { name: committer.name, email: committer.email, date: publishedAt };
      const commit = await expectOk(conn, "POST", `${at.repo}/git/commits`, {
        message: `Publish ${article.slug}`,
        tree: treeSha,
        parents: [headSha],
        author: person,
        committer: person,
      });
      if (!commit.ok) return { ok: false, error: commit.error };
      const commitSha = stringAt(commit.body, "sha");
      if (!commitSha) return { ok: false, error: "GitHub returned an unexpected commit" };

      // Moving the branch is what publishes: the core is asked once, right before.
      if (!claimed) {
        if (request.beforePost && !(await request.beforePost([]))) return { ok: false, error: "This Publication is already being sent" };
        claimed = true;
      }
      const moved = await call(conn, "PATCH", `${at.repo}/git/refs/${ref}`, { sha: commitSha, force: false });
      if (!moved.ok) return moved;
      if (isSuccess(moved.answer)) {
        return { ok: true, outcome: { externalId: commitSha, status: "published", externalUrl: articleUrlOf(at.layout, article.slug) } };
      }
      // 422: the branch moved since it was read; the commit is dropped and built again on the new head.
      if (moved.answer.status === 422 && attempt < MAX_ATTEMPTS) continue;
      if (moved.answer.status === 422) return { ok: false, error: `The branch ${at.branch} kept moving while publishing: try again` };
      return refusal(moved.answer);
    }
  },

  // A retry after an uncertain send: the file at the article's path, committed
  // since the attempt started, is the post a lost attempt made. An older file is
  // someone else's: no match, and the send then refuses to overwrite it.
  async findPost(conn, query) {
    const parsed = articleOf(query.publishable);
    if (!parsed.ok) return { ok: false, error: `Cannot look for the article: ${parsed.error}` };
    const located = await locate(conn, query.channelId, query.settings);
    if (!located.ok) return located;
    const { at } = located;
    const path = contentPathOf(at.layout, parsed.article.slug);
    const found = await fileExists(conn, at, path);
    if (!found.ok) return found;
    if (!found.exists) return { ok: true, post: null };
    const commits = await expectOk(conn, "GET", `${at.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(at.branch)}&per_page=1`);
    if (!commits.ok) return commits;
    const latest = Array.isArray(commits.body) ? commits.body[0] : undefined;
    const sha = stringAt(latest, "sha");
    if (!sha) return { ok: false, error: `GitHub gave no commit for ${path}` };
    const date = Date.parse(stringAt(latest, "commit", "committer", "date") ?? "");
    if (!(date >= query.attemptStartedAt - MARGIN_MS)) return { ok: true, post: null };
    return { ok: true, post: { externalId: sha, status: "published", externalUrl: articleUrlOf(at.layout, parsed.article.slug) } };
  },

  // The commit names the article it added; the post is published while that file is on the branch.
  async getStatus(conn, externalId, _around, target) {
    if (!target) return { ok: false, error: "GitHub needs the channel to read the status of a commit" };
    const res = channelOf(target.channelId, target.settings);
    if (!res.ok) return res;
    const { channel } = res;
    const commit = await call(conn, "GET", `${channel.repo}/commits/${encodeURIComponent(externalId)}`);
    if (!commit.ok) return commit;
    const gone = (error: string): PublisherResult<{ post: PostStatus }> => ({ ok: true, post: { status: "failed", error } });
    if (commit.answer.status === 404 || commit.answer.status === 422) return gone(`The commit ${externalId} no longer exists in ${target.channelId}`);
    if (!isSuccess(commit.answer)) return refusal(commit.answer);
    const files = (commit.answer.body as { files?: unknown } | null)?.files;
    const page = (Array.isArray(files) ? files : [])
      .map((f) => stringAt(f, "filename"))
      .map((path) => (path ? { path, slug: slugOfContentPath(channel.layout, path) } : undefined))
      .find((entry): entry is { path: string; slug: string } => entry?.slug !== undefined);
    if (!page) return gone(`The commit ${externalId} carries no article under ${channel.layout.contentBase || "the repository root"}`);
    const located = await locate(conn, target.channelId, target.settings);
    if (!located.ok) return located;
    const found = await fileExists(conn, located.at, page.path);
    if (!found.ok) return found;
    return found.exists
      ? { ok: true, post: { status: "published", externalUrl: articleUrlOf(channel.layout, page.slug) } }
      : gone(`The article ${page.path} is no longer on ${located.at.branch}`);
  },
};
