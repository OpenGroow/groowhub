import type { PublisherResult } from "@opengroow/publisher-sdk";

// The options of a channel (`channel-options.json`). The Publisher writes to a
// site built on @megaclaw/blog-utils: its articles are `<site>/<articlesFolder>/<slug>.md`
// (the directory the site gives `createBlogClient`: blog-utils does not impose one).
// Its covers are written to `<site>/<coversFolder>/<slug>.webp` and named in the
// frontmatter as `<coversPath>/<slug>.webp`: where the site serves its static files
// depends on its framework (`public/` for Next.js, `static/` for SvelteKit), so both
// are asked, nothing is derived.

export type Layout = { branch?: string; contentBase: string; coverBase: string; publicBase: string; articleBaseUrl: string };

const LABELS = {
  articlesFolder: "Folder of the articles",
  coversFolder: "Folder of the covers",
  coversPath: "URL path of the covers",
  articleBaseUrl: "URL of the articles",
} as const;
const REQUIRED = ["articlesFolder", "coversFolder", "coversPath", "articleBaseUrl"] as const;

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
      contentBase: join(site, text("articlesFolder").replace(/^\/+|\/+$/g, "")),
      coverBase: join(site, text("coversFolder").replace(/^\/+|\/+$/g, "")),
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
