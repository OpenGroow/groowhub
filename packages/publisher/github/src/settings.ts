import type { PublisherResult } from "@opengroow/publisher-sdk";

// The options of a channel (`channel-options.json`). The Publisher writes to a
// site built on @megaclaw/blog-utils: its articles are `<site>/content/blog/<slug>.md`
// (the directory every such site gives `createBlogClient`), and its covers are
// served by the site from `<site>/public<coversPath>`. Only what differs between
// sites is asked: where the site is in the repository, where it serves covers,
// and the URL of its articles.

export type Layout = { branch?: string; contentBase: string; coverBase: string; publicBase: string; articleBaseUrl: string };

/** The blog-utils directory of the articles, relative to the site. */
const BLOG_DIR = "content/blog";

const LABELS = { coversPath: "Public path of the covers", articleBaseUrl: "URL of the articles" } as const;
const REQUIRED = ["coversPath", "articleBaseUrl"] as const;

export function layoutOf(settings: Record<string, unknown> | undefined): PublisherResult<{ layout: Layout }> {
  const text = (key: string) => (typeof settings?.[key] === "string" ? (settings[key] as string).trim() : "");
  const missing = REQUIRED.filter((key) => text(key) === "");
  if (missing.length > 0) {
    return { ok: false, error: `Set ${missing.map((key) => LABELS[key]).join(", ")} on this channel (Publishers page)` };
  }
  const site = text("siteFolder").replace(/^\/+|\/+$/g, "");
  const publicBase = `/${text("coversPath").replace(/^\/+|\/+$/g, "")}`.replace(/\/$/, "");
  return {
    ok: true,
    layout: {
      ...(text("branch") ? { branch: text("branch") } : {}),
      contentBase: join(site, BLOG_DIR),
      coverBase: join(site, `public${publicBase}`),
      publicBase,
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
