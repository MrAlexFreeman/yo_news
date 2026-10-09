/**
 * How long a story takes to read.
 *
 * Words rather than characters: that is how the estimate is actually made, and a
 * character count makes a photo-heavy piece look like a four-minute read when it is
 * four seconds. The rate is the usual 180 words per minute for Russian prose.
 *
 * Pure and derived at render time from the stored body, so there is no column to
 * backfill and no way for the number to go stale after an edit.
 */

/** Average adult reading speed for Russian prose, words per minute. */
export const WORDS_PER_MINUTE = 180;

/** Words in an HTML body: tags, comments and script/style content removed. */
export function countWords(html: string): number {
  if (!html) return 0;

  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    // Entities stand in for a character, not a word — `&nbsp;` must not count as one.
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Estimated reading time in whole minutes, never less than one. */
export function readingMinutes(html: string): number {
  return Math.max(1, Math.round(countWords(html) / WORDS_PER_MINUTE));
}
