import type { PublisherResult } from "@opengroow/publisher-sdk";
import { publicCoverOf, type Layout } from "./settings";

// The `article` Publishable (ADR-074) and the markdown page committed for it.

export type Article = { markdownUrl: string; coverUrl: string; slug: string; title: string; description: string; category?: string };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function articleOf(publishable: Record<string, unknown> | undefined): PublisherResult<{ article: Article }> {
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
export function articleMarkdown(article: Article, layout: Layout, publishedAt: string, source: string): string {
  const quote = (value: string) => JSON.stringify(value); // a JSON string is a YAML double-quoted scalar
  const lines = [
    "---",
    `title: ${quote(article.title)}`,
    `description: ${quote(article.description)}`,
    `publishedAt: ${quote(publishedAt)}`,
    `cover: ${quote(publicCoverOf(layout, article.slug))}`,
    ...(article.category ? [`category: ${quote(article.category)}`] : []),
    "---",
  ];
  const body = source.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").replace(/^(?:[ \t]*\r?\n)+/, "");
  return `${lines.join("\n")}\n\n${body}`;
}
