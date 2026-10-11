/**
 * What this reader has already opened, and what to offer them instead.
 *
 * The closing grid under a story answers "what else is there", and until now it answered it
 * the same way to everyone: the same three cards under the same heading, every visit. A reader
 * who has been on the site all morning meets stories they finished two hours ago, in the block
 * whose whole job is to be the next thing they read.
 *
 * So the block is drawn from a longer pool and filtered in the browser, against a list of slugs
 * this browser has already opened. Client-side rather than server-side because the server has
 * no idea who is reading — the article pages are cached HTML shared by everybody — and because
 * a cookie would mean asking the reader to consent to being followed around a news site.
 *
 * Everything here is pure and takes the storage as an argument, so the whole of it — the cap,
 * the deduplication, the fallback — is testable without a browser.
 */

/** The key this list lives under. Named for the data, not for the feature, so it survives. */
export const VIEWED_STORAGE_KEY = "viewed_articles";

/**
 * How many slugs are kept.
 *
 * Fifty is a fortnight of reading on this site, and about 2 KB of storage: past that the list
 * stops earning its keep, because a story from a month ago is not what the reader is avoiding.
 */
export const VIEWED_LIMIT = 50;

/**
 * The part of `localStorage` this module needs.
 *
 * Narrowed to two methods rather than typed as `Storage` so a test can pass a plain object —
 * and so the browser-only API cannot creep into the rest of the module.
 */
export type ViewedStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * The list, oldest last, or empty.
 *
 * Every failure answers empty rather than throwing: the value is written by this module but
 * lives in a store the reader can edit, another tab can corrupt, or the browser can refuse
 * outright in private mode. A recommendation block is not the place to find out.
 */
export function readViewed(storage: ViewedStorage): string[] {
  try {
    const raw = storage.getItem(VIEWED_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, VIEWED_LIMIT);
  } catch {
    return [];
  }
}

/**
 * The list with `slug` moved to the front.
 *
 * A reader who opens the same story twice should not have it appear twice in the list, and
 * "most recently read first" is what makes the cap drop the least relevant entries.
 */
export function withViewed(viewed: readonly string[], slug: string): string[] {
  const trimmed = slug.trim();
  if (!trimmed) return [...viewed.slice(0, VIEWED_LIMIT)];
  return [trimmed, ...viewed.filter((value) => value !== trimmed)].slice(0, VIEWED_LIMIT);
}

/** Records a visit and returns the list as stored. */
export function rememberViewed(storage: ViewedStorage, slug: string): string[] {
  const next = withViewed(readViewed(storage), slug);
  try {
    storage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, or a full quota. The list still works for this page view.
  }
  return next;
}

/**
 * The cards to show: the ones this reader has not opened, topped up so the row is never short.
 *
 * Three rules, and the third is the one the brief is built on:
 *
 *  1. Unopened stories come first, so the block is about what is next rather than what is past.
 *  2. The row is then filled from what is left, up to `size`. A row of one card under a heading
 *     reads as a failed request, and the pool is short by design — it is one row of a page, not
 *     a feed. This is the "never empty" guarantee, expressed as "never half-empty either".
 *  3. When the reader has opened **everything** in the pool, the pool is offered again as it
 *     stands. Hiding all of it would leave the block empty, which is the outcome this whole
 *     module exists to prevent — a story read twice is a smaller failure than a blank page.
 */
export function pickUnseen<T extends { slug: string }>(
  pool: readonly T[],
  viewed: readonly string[],
  size: number,
): T[] {
  if (size <= 0) return [];
  if (pool.length === 0) return [];

  const seen = new Set(viewed);
  const unseen = pool.filter((story) => !seen.has(story.slug));

  if (unseen.length === 0) return pool.slice(0, size);

  const rest = pool.filter((story) => seen.has(story.slug));
  return [...unseen, ...rest].slice(0, size);
}
