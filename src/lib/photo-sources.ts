/**
 * Photo-credit suggestions.
 *
 * Pure, so the editorial suite can assert on the merge without a database. The
 * endpoint does the distinct query; this module owns the house list and the rule for
 * combining the two.
 */

/**
 * Sources the newsroom uses every week, always offered.
 *
 * First in the list rather than appended, because the point of the picker is one
 * click for the common case and these are the common cases. A source that appears
 * only after two articles have used it is a source nobody will ever reach.
 *
 * Deliberately not free-text-derived: these are the credits the desk has agreed to
 * print, and the ones most likely to be spelled correctly. Anything typed by hand is
 * added to the same list for the next story, which is how the house list grows
 * without anybody maintaining it.
 */
export const SYSTEM_SOURCES = [
  "Сгенерировано нейросетью",
  "Пресс-служба ГУ МЧС по Свердловской области",
  "Отделение пропаганды ГИБДД Екатеринбурга",
  "Пресс-служба администрации Екатеринбурга",
  "Архив редакции",
  "Фото: читатель / соцсети",
] as const;

/** What an AI cover is credited to when the editor has not said otherwise. */
export const AI_GENERATED_SOURCE = "Сгенерировано нейросетью";

/** Longest credit before it stops being a credit. */
export const SOURCE_LIMIT = 120;

/**
 * Folds the sources already in use into the house list.
 *
 * Deduplicated case-insensitively but keeping the first spelling seen, because
 * "Архив редакции" and "архив редакции" are the same credit and an editor should
 * not have to guess which one the site already prints. Blank values are dropped:
 * the column is nullable and plenty of rows have none.
 *
 * The house entries come first and are never displaced by a near-duplicate from the
 * database, so the list cannot silently grow a second "Сгенерировано нейросетью" in
 * a different capitalisation.
 */
export function mergePhotoSources(distinct: readonly string[]): string[] {
  const merged: string[] = [...SYSTEM_SOURCES];
  const seen = new Set(merged.map((entry) => entry.trim().toLowerCase()));

  for (const raw of distinct) {
    const value = (raw ?? "").trim().slice(0, SOURCE_LIMIT);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(value);
  }

  return merged;
}