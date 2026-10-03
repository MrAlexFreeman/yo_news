/**
 * Turns whatever the editor typed into block HTML.
 *
 * The content field is a plain source textarea, so editors paste and type plain
 * text as often as they write tags. HTML collapses newlines: "line one\nline two"
 * renders as "line one line two", and a pasted article arrives as one solid
 * paragraph. The prose plugin cannot help, because by the time it renders there
 * are no paragraphs left to style.
 *
 * This runs on save, on the way in, so the stored HTML matches what the editor
 * meant and the public page can render it with ordinary block markup.
 */

/** Tags that already provide block structure; text between them needs no <p>. */
const BLOCK_OPENING =
  /<\/?(?:p|div|section|article|h[1-6]|ul|ol|li|dl|dt|dd|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|figure|figcaption|hr|iframe)\b/i;

/**
 * Regions where a newline is meaningful and must never be rewritten: code
 * samples would be destroyed by a <br>, and an iframe's content is opaque.
 */
const PROTECTED = /<(pre|code|iframe|textarea)\b[\s\S]*?<\/\1\s*>/gi;

const PLACEHOLDER = (index: number) => `\u0000PROTECTED${index}\u0000`;

export function normalizeArticleHtml(input: string): string {
  if (!input.trim()) return "";

  // Lift the protected regions out first, so a <br> never lands inside a code
  // sample and the block splitting below cannot see their contents.
  const held: string[] = [];
  const masked = input.replace(PROTECTED, (match) => {
    held.push(match);
    return PLACEHOLDER(held.length - 1);
  });

  // A blank line is the editor's paragraph break; single newlines are line
  // breaks inside a paragraph.
  const blocks = masked
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const rendered = blocks.map((block) => {
    const withBreaks = block
      .replace(/\r?\n/g, "<br />")
      // A newline the editor typed *between* two block tags is formatting
      // whitespace, not a line break: `</p>\n<h2>` is how formatted HTML is
      // normally written, and turning that into a <br /> inserts a blank line
      // above every heading. Only a <br /> with markup on both sides qualifies.
      .replace(/>\s*<br \/>\s*</g, "><");

    // Already block markup: leave it alone apart from the newline fix above.
    return BLOCK_OPENING.test(withBreaks) ? withBreaks : `<p>${withBreaks}</p>`;
  });

  return rendered.join("\n").replace(
    /\u0000PROTECTED(\d+)\u0000/g,
    (_, index: string) => held[Number(index)] ?? "",
  );
}

/**
 * Plain-text preview for the editor's "Предпросмотр" panel: strips tags and
 * collapses whitespace so the editor sees approximately the word count and the
 * opening of the story without rendering live markup.
 */
export function plainTextPreview(html: string, limit = 400): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}