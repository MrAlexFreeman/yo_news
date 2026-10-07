/**
 * Search helpers for the editor's "find a story on the site" box.
 *
 * Pure, so the security suite can assert on the query-building without a database.
 */

import type { Prisma } from "@/generated/prisma/client";

/** Below this a keystroke is not a search yet, just noise. */
export const MIN_QUERY_LENGTH = 2;

/** How many rows the endpoint offers. The dialog shows five to seven. */
export const SEARCH_TAKE = 10;

export type SearchHit = {
  id: string;
  title: string;
  slug: string;
  publishedAt: string | null;
};

/**
 * Folds the case of the text that the search box matches against.
 *
 * The same reason `Tag.nameKey` exists: SQLite's LIKE and LOWER() are ASCII-only,
 * so a Russian query never matches a Russian title unless both sides are folded in
 * JS first. Joining title and lead into one column means a single `contains` covers
 * both fields the editors expect to search.
 */
export function buildSearchText(title: string, lead?: string | null): string {
  return [title, lead].filter(Boolean).join(" ").toLowerCase().trim();
}

/** Trims and clamps a raw query from the URL. */
export function normaliseQuery(raw: string | null): string {
  return (raw ?? "").trim().slice(0, 100);
}

export function isSearchable(query: string): boolean {
  return query.length >= MIN_QUERY_LENGTH;
}

/**
 * The `where` for a published-article search.
 *
 * `status: "published"` and not `"PUBLISHED"`: `status` is a plain String column
 * whose values are constrained in app code by the `ArticleStatus` union, and the
 * stored value is lower-case. An upper-case literal matches nothing and the
 * search box would simply always be empty.
 *
 * Drafts are excluded because the box links to `/news/<slug>`, and a draft has no
 * public page to link to — offering one would hand the editor a 404.
 *
 * Trashed stories are excluded for exactly the same reason, and this is the one
 * place that was not obvious: this is an *admin* box, so the instinct is that an
 * editor should still be able to find anything they once published. But it links to
 * the public page, and a trashed story has none. The trash tab is where they belong.
 */
export function buildSearchWhere(query: string): Prisma.ArticleWhereInput {
  return {
    status: "published",
    deletedAt: null,
    searchText: { contains: query.toLowerCase() },
  };
}

/**
 * The relative URL an editor gets when they pick a hit.
 *
 * Site-relative on purpose: it survives a future domain change, and the slug is
 * encoded rather than pasted so a slug carrying a slash or a Cyrillic character
 * cannot produce a URL that points somewhere else.
 */
export function articlePath(slug: string): string {
  return `/news/${encodeURIComponent(slug.trim())}`;
}
