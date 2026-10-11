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

/**
 * `[текст](url)` in Markdown.
 *
 * Editors paste and type links far more often than they type tags, and the
 * toolbar's insert-link button needs text selected first — which is exactly the
 * step people skip when they want a link on the opening line. Markdown syntax
 * survives that: it is what they already type into every other editor, and it
 * reads as a link in the raw textarea instead of as invisible markup.
 *
 * Deliberately conservative about the URL: only schemes a reader can follow are
 * converted, and anything else is left as literal text. Rewriting it here means a
 * `javascript:` link never reaches the database, rather than depending on the
 * sanitiser to strip the attribute later.
 */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g;

/** Schemes a link in a news story can legitimately use. */
const LINKABLE_SCHEME = /^(?:https?:\/\/|mailto:|tel:|\/|#)/i;

export function markdownLinksToHtml(input: string): string {
  return input.replace(MARKDOWN_LINK, (match, label: string, url: string) => {
    if (!LINKABLE_SCHEME.test(url)) return match;

    return `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`;
  });
}

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

    // Markdown links are converted after the newline handling, so a link spread
    // across two lines is not silently glued into one word.
    const withLinks = markdownLinksToHtml(withBreaks);

    // Already block markup: leave it alone apart from the newline fix above.
    return BLOCK_OPENING.test(withLinks) ? withLinks : `<p>${withLinks}</p>`;
  });

  return rendered.join("\n").replace(
    /\u0000PROTECTED(\d+)\u0000/g,
    (_, index: string) => held[Number(index)] ?? "",
  );
}

/**
 * Phrases that promise more reading. A body may end with one and nothing behind it.
 *
 * Lower case, because the comparison below folds the paragraph's text down to it: an
 * editor may type «Читайте также», «ЧИТАЙТЕ ТАКЖЕ» or «Читайте так же», and all three are
 * the same dead end to a reader.
 */
const KICKER_PHRASES: readonly string[] = [
  "читайте также",
  "читать также",
  "читайте так же",
  "почитайте также",
  "прочитайте также",
  "читать далее",
  "смотрите также",
  "читайте еще",
  "читайте ещё",
];

/**
 * Drops a trailing paragraph that is nothing but a kicker — «Читайте также:» with no link.
 *
 * **Why this exists.** A body whose last line is «Читайте также:» and nothing after it reads as
 * a broken page: the site has promised more and delivered an empty line, at exactly the moment
 * the reader is deciding whether to stay. It is produced by hand and by models alike — the
 * phrase is added as a lead-in and the link never gets made.
 *
 * **What it does not touch**, and each is a real body on this site:
 *
 *   `<p>Читайте также: <a href=…>Заголовок</a></p>`   → kept, the promise is met
 *   `<p>Прочитайте также, как <a href=…>медведь…</a></p>` → kept, the kicker carries prose
 *   `<p>…а также состояние водителя установят…</p>`     → kept, not a kicker at all
 *
 * So only the **last** paragraph is considered, only when it holds no link, and only when
 * nothing but the phrase is left after the tags and the trailing punctuation are removed. A
 * kicker in the middle of a body is left alone: the site cannot know whether the paragraph
 * after it was meant to be the link.
 *
 * Runs on the way out rather than on save, so it also repairs the bodies already stored, and
 * so a paragraph deleted in the editor is not a decision taken behind the editor's back.
 */
export function stripTrailingKicker(html: string): string {
  // Anchored at the very end, so this is about the article's last line and nothing else.
  const trailing = /<\/p\s*>\s*$/i.exec(html);
  if (!trailing) return html;

  const closeStart = trailing.index;
  const lower = html.toLowerCase();
  // `<p>` and `<p class=…>` are both openings; `<pre>` is not, and the character after the
  // `p` is what tells them apart.
  const openIndex = Math.max(lower.lastIndexOf("<p>", closeStart), lower.lastIndexOf("<p ", closeStart));
  if (openIndex < 0) return html;

  const gt = html.indexOf(">", openIndex);
  if (gt < 0 || gt >= closeStart) return html;

  const inner = html.slice(gt + 1, closeStart);

  // A link means the paragraph says where to go. Without one it is the broken case.
  if (/<a\b/i.test(inner)) return html;

  const text = inner
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:;,.!?…—–-]+$/u, "")
    .trim()
    .toLowerCase();

  if (!KICKER_PHRASES.includes(text)) return html;

  return `${html.slice(0, openIndex)}${html.slice(closeStart + trailing[0].length)}`;
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