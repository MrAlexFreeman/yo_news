/**
 * The rubricator, in the order the editorial grid shows it.
 *
 * One list rather than four. The header, the footer, the admin's fallback dropdown and
 * the database seed all need the same rubrics, and when each carried its own copy they
 * drifted: a category could exist in the database and be unreachable from the
 * navigation, or appear in the navigation and 404. The seed and the footer read this
 * file, so a rubric is added in one place.
 *
 * The order is explicit because the 2026 grid is not alphabetical — «Расследования»
 * leads the navigation — and a database `orderBy: name` would silently re-sort it.
 */

export type CategoryDefinition = { slug: string; name: string };

/** The rubrics, in navigation order. */
export const CATEGORIES: readonly CategoryDefinition[] = [
  { slug: "investigations", name: "Расследования" },
  { slug: "lifestyle", name: "Здоровье и стиль" },
  { slug: "home-garden", name: "Дом и сад" },
  { slug: "cinema", name: "Кино и сцена" },
  { slug: "incidents", name: "Происшествия" },
  { slug: "society", name: "Общество" },
  { slug: "economy", name: "Экономика" },
];

/**
 * Where an article from a retired rubric is filed.
 *
 * Reassigned rather than deleted: the stories keep their own URLs, so an external link
 * to the article still resolves, and only the rubric that held it changes. The retired
 * rubric's own URL is redirected to this one in `next.config.ts`.
 */
export const FALLBACK_CATEGORY_SLUG = "society";

/** Rubrics the 2026 rework retired. Their articles moved to `FALLBACK_CATEGORY_SLUG`. */
export const RETIRED_CATEGORY_SLUGS = [
  "politics",
  "tech",
  "science",
  "sport",
  "culture",
] as const;

/**
 * Rubrics the "события дня" row of the article loop is drawn from.
 *
 * A short list on purpose: the row answers "what else happened today", and a rubric
 * that does not produce daily news does not belong in it. «Общество» is last so a row
 * is never filled with city news that a reader in another city cannot use. When the list
 * yields fewer stories than the row needs, the query widens to every rubric rather than
 * showing a short row.
 */
export const LOOP_HIGHLIGHT_RUBRICS = [
  "investigations",
  "incidents",
  "economy",
  "society",
] as const;

/** Display order for a slug. Unknown slugs sort last, together. */
export function categoryRank(slug: string): number {
  const index = CATEGORIES.findIndex((category) => category.slug === slug);
  return index === -1 ? CATEGORIES.length : index;
}

/** Display name for a slug, or null when it is not a current rubric. */
export function categoryName(slug: string): string | null {
  return CATEGORIES.find((category) => category.slug === slug)?.name ?? null;
}
