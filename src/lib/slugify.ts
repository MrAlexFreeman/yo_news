/**
 * URL-safe slugs shared by article and tag creation.
 *
 * Was a private helper inside the article Server Action, which left the tag code
 * unable to reuse it without importing from an actions module — a "use server"
 * file may only export async functions, so the helper had to move out before
 * tags could have a slug at all.
 */

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

/**
 * Turns a Russian title or tag name into a URL slug. Falls back to a stable
 * placeholder when the input is entirely non-Latin, since the slug is required
 * and unique.
 */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[Ѐ-ӿ]/g, (char) => TRANSLIT[char] ?? "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "material"
  );
}