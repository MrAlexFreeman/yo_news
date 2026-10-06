/**
 * Turns what a forum visitor typed into the small HTML vocabulary posts are stored
 * in.
 *
 * The visitor types into a textarea: plain text with line breaks, and the two
 * conventions every forum has — a blank line between paragraphs, and `>` to quote.
 * This converts that into `<p>`, `<br>` and `<blockquote>`, which is all
 * `sanitizeForumHtml` allows.
 *
 * Escaping happens first, deliberately. A poster who writes `<b>жирно</b>` or pastes
 * markup should see their own characters, not have them parsed — and escaping before
 * the element-building step means there is no point at which input is interpreted
 * as markup. The sanitiser still runs afterwards, so this function is about shape
 * and the sanitiser is about safety; the second does not depend on the first being
 * correct.
 */

/** Hard cap on a stored post, applied before anything is stored. */
export const FORUM_POST_MAX_LENGTH = 4000;

/** Hard cap on a topic title. Short enough to stay readable in a list. */
export const FORUM_TITLE_MAX_LENGTH = 120;

/** Hard cap on the display name a visitor types. */
export const FORUM_NAME_MAX_LENGTH = 40;

/**
 * Control characters that survive copy-paste from a PDF or a terminal and would
 * otherwise end up stored. Tabs and newlines are kept — they are the formatting.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Escapes the five characters that can start or close a tag. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wraps already-escaped text in a tag. */
function wrap(tag: "p" | "blockquote", inner: string): string {
  return `<${tag}>${inner}</${tag}>`;
}

/**
 * Plain text to post HTML.
 *
 * Blank line → new paragraph. Single newline inside a paragraph → `<br>`. A run of
 * lines each starting with `>` → one `blockquote`, with the markers removed.
 *
 * Empty input yields an empty string rather than an empty `<p></p>`, so a blank
 * submission is caught by the length check instead of by the markup.
 */
export function forumTextToHtml(input: string): string {
  const text = input.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  if (!text.trim()) return "";

  const blocks: string[] = [];

  // Paragraphs first: a blank line is the only structural marker in plain text.
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((line) => line.trim());
    if (lines.length === 0) continue;

    const quoted: string[] = [];
    const plain: string[] = [];

    for (const line of lines) {
      if (/^\s*>/.test(line)) {
        quoted.push(line.replace(/^\s*>\s?/, ""));
      } else {
        plain.push(line);
      }
    }

    // A quoted run and a plain run are separate paragraphs, and a quote that
    // interrupts a paragraph stays its own block rather than rejoining it.
    const plainText = plain.join("\n").trim();
    if (plainText) {
      blocks.push(wrap("p", escapeHtml(plainText).replace(/\n/g, "<br>")));
    }
    if (quoted.length) {
      const inner = escapeHtml(quoted.join("\n").trim()).replace(/\n/g, "<br>");
      blocks.push(wrap("blockquote", inner));
    }
  }

  return blocks.join("");
}

/**
 * The hidden field a bot fills and a person never sees.
 *
 * The name is the whole design. A honeypot named `email` or `url` is filled by the
 * browser itself — Chrome and Firefox autofill those by name regardless of the input
 * type — so every genuine visitor would arrive as a bot and be silently discarded,
 * and the field would protect nothing. `companie` is not an autofill target on any
 * browser and is still ordinary enough that a script walking the form's inputs fills
 * it in.
 */
export const FORUM_HONEYPOT_FIELD = "companie";

/** True when a submission looks like it came from a script. */
export function isHoneypotFilled(formData: FormData): boolean {
  const value = formData.get(FORUM_HONEYPOT_FIELD);
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Cuts a string to `limit`, preferring a word boundary.
 *
 * Used on display names and titles rather than on post bodies: a post that exceeds
 * the limit is rejected outright, because silently truncating someone's argument is
 * worse than telling them it was too long.
 */
export function clampForumText(value: string, limit: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= limit) return trimmed;

  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour the word boundary if it is not cutting away most of the text.
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}
