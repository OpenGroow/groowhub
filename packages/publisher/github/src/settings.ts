import type { PublisherResult } from "@opengroow/publisher-sdk";

// The options of a GitHub channel (`channel-options.json`): where an article
// and its cover go in the repository, and where the site shows them.

export type Layout = { branch?: string; contentBase: string; coverBase: string; publicBase: string; articleBaseUrl: string };

const REQUIRED = ["contentBase", "coverBase", "publicBase", "articleBaseUrl"] as const;

export function layoutOf(settings: Record<string, unknown> | undefined): PublisherResult<{ layout: Layout }> {
  const text = (key: string) => (typeof settings?.[key] === "string" ? (settings[key] as string).trim() : "");
  const missing = REQUIRED.filter((key) => text(key) === "");
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

/** `<contentBase>/<slug>.md`: the article's page, and how a post is found again. */
export const contentPathOf = (layout: Layout, slug: string) => join(layout.contentBase, `${slug}.md`);
export const coverPathOf = (layout: Layout, slug: string) => join(layout.coverBase, `${slug}.webp`);
/** The cover as the site serves it, written in the frontmatter. */
export const publicCoverOf = (layout: Layout, slug: string) => `${layout.publicBase}/${slug}.webp`;
export const articleUrlOf = (layout: Layout, slug: string) => `${layout.articleBaseUrl}/${slug}`;

/** The slug of an article page directly under `contentBase`, or undefined for any other path. */
export function slugOfContentPath(layout: Layout, path: string): string | undefined {
  const prefix = layout.contentBase ? `${layout.contentBase}/` : "";
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return undefined;
  const slug = path.slice(prefix.length, -".md".length);
  return slug && !slug.includes("/") ? slug : undefined;
}
