import type { Prisma } from "@/generated/prisma/client";

import { SITE_NAME, siteUrl } from "@/lib/site";

/**
 * The Google News sitemap, as data rather than as a route handler.
 *
 * The route is three lines around this module, which is what makes the two rules that matter
 * testable without a database or an HTTP call: the **48-hour window** (Google News rejects
 * stories older than two days, and a stale entry is a rejection, not a warning) and **XML
 * escaping** (a headline with `&` or a bare `<` produces a file Google refuses to parse).
 */

/** Google News accepts only the last two days of stories. */
export const NEWS_WINDOW_HOURS = 48;

/**
 * Google News caps a single sitemap at 1,000 URLs.
 *
 * The 48-hour window keeps the real list far below it for a regional publication, but a
 * burst — a day of breaking news syndicated in bulk — must not silently produce an invalid
 * file, so the cap is explicit and the query is ordered newest-first.
 */
export const NEWS_SITEMAP_LIMIT = 1000;

/** The earliest publication date that still belongs in the sitemap. */
export function newsWindowStart(now: Date): Date {
  return new Date(now.getTime() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * What the sitemap includes.
 *
 * `status: "published"` is this project's spelling — the schema stores lowercase statuses
 * (`draft`, `published`, `hidden`…), not the `PUBLISHED` of the brief. Trashed stories and
 * `noIndex` ones are left out for the same reason the regular sitemap leaves them out: the
 * sitemap says "index this", and a page that answers `noindex` contradicts it.
 */
export function newsSitemapWhere(now: Date) {
  return {
    status: "published",
    deletedAt: null,
    noIndex: false,
    publishedAt: { gte: newsWindowStart(now) },
  } satisfies Prisma.ArticleWhereInput;
}

export type NewsSitemapEntry = {
  slug: string;
  title: string;
  publishedAt: Date;
};

/**
 * Characters XML 1.0 forbids outright, even escaped.
 *
 * A headline pasted from a word processor can carry them, and one such byte makes the whole
 * sitemap unparseable — every URL in it lost, not just the one story.
 */
const FORBIDDEN_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Escapes text for an XML text node or attribute value.
 *
 * `&` first: escaping it after `<` would turn `&lt;` into `&amp;lt;` and print the entity
 * instead of the character.
 */
export function escapeXml(value: string): string {
  return value
    .replace(FORBIDDEN_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Absolute story URL, from the same origin the rest of the site uses. */
export function newsEntryUrl(slug: string, origin: string = siteUrl): string {
  return new URL(`/news/${encodeURIComponent(slug)}`, origin).toString();
}

/**
 * The sitemap document.
 *
 * Format follows Google's news extension: `urlset` with the sitemap and news namespaces, and
 * per URL a `news:publication` (name + language), `news:publication_date` in W3C/ISO 8601 and
 * `news:title`. `toISOString()` is exactly that format, including the `Z`.
 */
export function buildNewsSitemap(
  entries: readonly NewsSitemapEntry[],
  origin: string = siteUrl,
): string {
  const urls = entries.map((entry) =>
    [
      "  <url>",
      `    <loc>${escapeXml(newsEntryUrl(entry.slug, origin))}</loc>`,
      "    <news:news>",
      "      <news:publication>",
      `        <news:name>${escapeXml(SITE_NAME)}</news:name>`,
      "        <news:language>ru</news:language>",
      "      </news:publication>",
      `      <news:publication_date>${entry.publishedAt.toISOString()}</news:publication_date>`,
      `      <news:title>${escapeXml(entry.title)}</news:title>`,
      "    </news:news>",
      "  </url>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
