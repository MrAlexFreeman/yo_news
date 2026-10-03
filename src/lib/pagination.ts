/** Pagination helpers shared by the category routes. */

export const PAGE_SIZE = 12;

/** Page count for a total of `total` items, never below one. */
export function totalPages(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Page 1 lives at the category root so the common case has a clean, canonical
 * URL; deeper pages live under /page/N and stay statically generated.
 */
export function categoryPageHref(slug: string, page: number): string {
  return page <= 1 ? `/category/${slug}` : `/category/${slug}/page/${page}`;
}

/** Same shape as the rubric routes, for tag listings. */
export function tagsPageHref(slug: string, page: number): string {
  return page <= 1 ? `/tags/${slug}` : `/tags/${slug}/page/${page}`;
}

/** Parses a path segment like "3" into a page number, defaulting to 1. */
export function parsePageSegment(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}
