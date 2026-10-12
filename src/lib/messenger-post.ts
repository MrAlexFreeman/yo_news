/**
 * The text of a messenger post, and the decisions about how to deliver it.
 *
 * Pure on purpose: no `fetch`, no `fs`, no `process.env`, no Prisma. Both publishers
 * are thin wrappers around this module, and the interesting part — where a post
 * stops fitting in a caption, where it stops fitting in a message at all, and where
 * a cut has to land so the reader is not shown half a sentence — is exactly the part
 * that is painful to verify by publishing real articles into a live channel.
 *
 * Lengths are measured in `String.prototype.length`, i.e. UTF-16 code units. Both
 * vendors document their limit in characters, and for the Cyrillic and emoji this
 * site actually posts the two agree; a surrogate pair (an emoji outside the BMP)
 * counts as 2 here and as 2 by Telegram's own reckoning as well. The one thing
 * this does not model is UTF-8 bytes, which is why the cut limits below sit well
 * under the hard ceilings rather than at them.
 */

/** Telegram's `sendPhoto` caption ceiling. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Telegram's `sendMessage` ceiling. One message per story, so this is also the cut trigger. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** How much of the post survives a cut. The notice adds roughly 90 more. */
export const LONG_READING_BODY_LIMIT = 3500;

/** MAX's documented `text` ceiling on `POST /messages`. */
export const MAX_MESSAGE_LIMIT = 4000;

/** The line that credits the site, as the editorial voice asks for. */
const SOURCE_PREFIX = "Ё-новости";

/** Appended after a cut, in place of the missing paragraphs. */
const READING_NOTICE = "📖 Полный текст расследования читайте на сайте";

/**
 * Block-level elements that end a paragraph.
 *
 * Not a general HTML parser: it only has to recognise the handful of tags the
 * editor's toolbar can produce, and anything unrecognised is dropped as a tag
 * while its text survives. `article-html.ts` normalises the stored body to that
 * same vocabulary.
 *
 * `li` is deliberately absent. A list item's break comes from the bullet that
 * `<li>` itself introduces, and listing `</li>` here as well would put a blank line
 * between consecutive items — which reads as two one-item lists.
 */
const BLOCK_END =
  /<\/(?:p|div|section|article|h[1-6]|blockquote|ul|ol|tr|figure|figcaption|pre)\s*>/gi;

/** A whole quotation, captured so its shape can be preserved instead of flattened. */
const BLOCKQUOTE = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi;

/**
 * A paragraph that holds nothing but the attribution of a quotation.
 *
 * Tolerant of the wrapping `<p>` because the split in `quoteAsText` leaves each block
 * starting at its opening tag: the attribution arrives as `<p><cite>— Иван Петров</cite>`,
 * not as a bare `<cite>`.
 */
const ATTRIBUTION_ONLY =
  /^\s*(?:<p\b[^>]*>)?\s*<cite\b[^>]*>[\s\S]*?<\/cite\s*>\s*(?:<\/p\s*>)?\s*$/i;

/** A figure, whose caption survives but whose image does not. */
const FIGURE_OPEN = /<figure\b[^>]*>/gi;

/**
 * Opens every quoted paragraph.
 *
 * Telegram's `parse_mode: HTML` and MAX's `format: "html"` accept a small, and
 * *different*, vocabulary of tags — Telegram understands `<blockquote>`, MAX does not
 * document it — and the same post string is sent to both, so emitting a tag one of them
 * rejects would lose the whole message rather than the quotation. A character prefix is
 * understood everywhere and survives being forwarded, quoted in a reply, or copied out
 * of the app, none of which a tag would.
 *
 * The glyph is a low-9 double quote, which is what opens a quotation in Russian, and it
 * is followed by a space so the text does not touch it.
 */
export const MESSENGER_QUOTE_PREFIX = "„ ";

/** Tags that mean a hard line break rather than a paragraph break. */
const LINE_BREAK = /<br\s*\/?>/gi;

/** Horizontal rules and similar: a break, not a line of text. */
const STANDALONE_BREAK = /<(?:hr)\s*\/?>/gi;

/** List items get a bullet, because "• something" reads better than "something". */
const LIST_ITEM = /<li\b[^>]*>/gi;

/** Elements whose content is not article text at all. */
const DROPPED_CONTENT = /<(script|style|noscript)\b[\s\S]*?<\/\1>/gi;

/** Every remaining tag, opening or closing, self-closing or not. */
const ANY_TAG = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&laquo;": "«",
  "&raquo;": "»",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&deg;": "°",
};

/**
 * Decodes the entities an editor's HTML actually contains, including numeric ones.
 *
 * Runs *after* the tags are stripped and *before* the result is re-escaped, which is
 * the order that makes `<b>жирно</b>` typed as text come out as the six visible
 * characters `<b>жирно</b>` rather than as bold. Escaping first and decoding second
 * would let a visitor's `&amp;lt;b&amp;gt;` turn back into live markup.
 */
function decodeEntities(text: string): string {
  let out = text.replace(
    /&(?:nbsp|amp|lt|gt|quot|apos|laquo|raquo|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|deg);/g,
    (match) => NAMED_ENTITIES[match.toLowerCase()] ?? match,
  );

  out = out.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
    safeFromCodePoint(Number.parseInt(hex, 16)),
  );
  out = out.replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)));

  return out;
}

/** `String.fromCodePoint` throws on out-of-range values; a bad entity is not fatal. */
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * A quotation as text: every quoted paragraph opened with a marker, the attribution
 * left alone.
 *
 * The attribution is recognised by being a paragraph that holds nothing but a `<cite>`.
 * It must not get the quotation marker — "„ — Иван Петров" would read as though the
 * speaker had said the dash and their own name. The dash itself is already part of the
 * inserted text, so nothing is added here.
 */
function quoteAsText(inner: string): string {
  const blocks = inner
    .split(/<\/p\s*>|<br\s*\/?>/i)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const lines = blocks.map((block) => {
    const text = htmlToPlainText(block);
    if (!text) return "";
    // A block that is only an attribution keeps its own line and no marker.
    return ATTRIBUTION_ONLY.test(block) ? text : `${MESSENGER_QUOTE_PREFIX}${text}`;
  });

  const quoted = lines.filter(Boolean).join("\n\n");
  // Blank lines on both sides so the quotation stands apart from the article's own
  // paragraphs, the same way the rule and the wash do on the page.
  return `\n\n${quoted}\n\n`;
}

/**
 * Phrases that introduce more reading somewhere else.
 *
 * A body may carry a paragraph that does nothing but point at another story — and in a
 * messenger it stops being a pointer, because the link does not survive the conversion to
 * text. What is left is a line promising a story with nothing to click.
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
 * Whether a paragraph is nothing but a promise to read something elsewhere.
 *
 * Two shapes qualify, and they are the two the brief names:
 *
 *   «Читайте также:»                     → the colon is followed by the linked headline,
 *                                          which the conversion has left as bare words
 *   «Читайте также» / «Читать далее»     → nothing after it at all, the dangling case
 *
 * What does **not** qualify is a paragraph where the phrase introduces prose of its own:
 * «Прочитайте также, как медведь наведался в посёлок Кедровка» is a sentence in this article,
 * not a pointer out of it, and deleting it would delete content. The colon is what tells the
 * two apart — a pointer uses one, a sentence continues after a comma.
 */
function isKickerParagraph(paragraph: string): boolean {
  const plain = paragraph.replace(/\s+/g, " ").trim().toLowerCase();
  if (!plain) return false;

  const bare = plain.replace(/[:;,.!?…—–-]+$/u, "").trim();
  if (KICKER_PHRASES.includes(bare)) return true;

  return KICKER_PHRASES.some(
    (phrase) => plain.startsWith(phrase) && plain.slice(phrase.length).startsWith(":"),
  );
}

/**
 * Drops those paragraphs from a post's text.
 *
 * Paragraph-level rather than line-level, and before the text is escaped, so the comparison
 * sees real characters rather than `&amp;`-style entities.
 */
export function stripKickerLines(text: string): string {
  if (!text) return "";
  return text
    .split("\n\n")
    .filter((paragraph) => !isKickerParagraph(paragraph))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Editor HTML to plain text, with paragraphs and line breaks kept.
 *
 * `plainTextPreview` in `article-html.ts` collapses every run of whitespace, which is
 * right for a word-count preview and wrong here: a messenger post that arrives as
 * one 2000-character wall has lost the only structure the reader had.
 */
export function htmlToPlainText(html: string): string {
  if (!html || !html.trim()) return "";

  // Quotations are lifted out first, because the block stripping below is exactly what
  // destroys them: a `<blockquote>` becomes an ordinary paragraph break and the reader
  // of a Telegram post has no way to tell a quotation from the article's own words.
  const withQuotes = html.replace(BLOCKQUOTE, (_, inner: string) => quoteAsText(inner));

  let text = withQuotes.replace(DROPPED_CONTENT, " ");
  text = text.replace(LIST_ITEM, "\n• ");
  text = text.replace(FIGURE_OPEN, "\n\n");
  text = text.replace(BLOCK_END, "\n\n");
  text = text.replace(STANDALONE_BREAK, "\n\n");
  text = text.replace(LINE_BREAK, "\n");
  text = text.replace(ANY_TAG, "");
  text = decodeEntities(text);

  // A non-breaking space survives the HTML as U+00A0, which neither `.trim()` nor
  // `[ \t]` touch. Left in, it makes a paragraph look indented on the phone. Written
  // as an escape rather than as the character itself: an invisible byte in a source
  // file is something the next reader cannot see, let alone search for.
  text = text.replace(/\u00a0/g, " ");

  text = text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Escapes for Telegram's `parse_mode: HTML` and MAX's `format: "html"`.
 *
 * Both accept a small fixed vocabulary of tags and reject the whole message if they
 * meet anything else, which is why the body is sent as text rather than as the
 * editor's markup: a stray `<figure>` from the editor would take the whole post
 * down, not just that line.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Turns a rubric name into a hashtag.
 *
 * A hashtag cannot contain whitespace, so the words are joined with underscores
 * rather than dropped — "Мир и политика" must not silently become "#Мириполитика".
 * Cyrillic is kept: it is what the rubric is called on the site, and both Telegram
 * and MAX treat a hashtag as Unicode rather than as ASCII.
 */
export function toHashtag(name: string | null | undefined): string {
  const cleaned = (name ?? "")
    // Cyrillic and Latin letters, digits, and anything that may join two words.
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    // Several words run together because punctuation became an underscore each.
    .replace(/_{2,}/g, "_");

  return cleaned.length > 0 ? `#${cleaned}` : "";
}

export type MessengerPostInput = {
  title: string;
  /** The article body exactly as stored. */
  contentHtml: string;
  slug: string;
  /** Rubric name, used for the closing hashtag. Optional. */
  categoryName?: string | null;
  /** Absolute base, without a trailing slash. */
  siteUrl: string;
};

export type MessengerPost = {
  /** Ready to send, escaped for an HTML-capable messenger. */
  text: string;
  /** The canonical URL, kept separately so a cut can offer the full text. */
  url: string;
  /** The bold headline block on its own, as it appears at the top of `text`. */
  headline: string;
  /** The body alone, escaped: no headline, no credit, no rubric. */
  body: string;
  /** The rubric tag, escaped and already prefixed with `#`, or "" when there is no rubric. */
  hashtag: string;
};

/**
 * The post: bold headline, the whole body, then the credit and the rubric tag.
 *
 * The body goes first and the link last, which is the order the task asks for and
 * also the order that survives truncation: Telegram appends an ellipsis to a post
 * whose link is buried, and a channel reader scanning for the source should find it
 * without expanding anything.
 */
export function buildMessengerPost(input: MessengerPostInput): MessengerPost {
  const base = input.siteUrl.replace(/\/+$/, "");
  const url = `${base}/news/${input.slug}`;

  /*
    The body is escaped, and this is a fix for a failure that reached production.

    `htmlToPlainText` decodes entities, so an article containing `5 &lt; 6` produced a
    bare `<` in the post, and Telegram rejects a caption or message with a `<` that
    starts no valid tag — "can't parse entities" — *whole*. On a post long enough to be
    split, the cover went out first and the text message was refused, which is exactly
    the reported symptom: a channel showing a picture with nothing on it. A raw `&` in a
    body ("А & Б") fails the same way.

    The same escape closes an injection: text typed as `&lt;b&gt;нет&lt;/b&gt;` came back
    as a live `<b>` and bolded itself in the channel.
  */
  const body = escapeHtml(stripKickerLines(htmlToPlainText(input.contentHtml)));
  // `toHashtag` already strips everything but letters, digits and underscores, so this
  // is belt-and-braces: an entity can never appear here, and the escape says so.
  const hashtag = escapeHtml(toHashtag(input.categoryName));

  /*
    The credit and the rubric tag share one block, joined by a single newline rather
    than a blank line. They are one thought — where this came from and what it is
    filed under — and a blank line between them reads as the start of a new section in
    a post that is otherwise a wall of paragraphs.
  */
  const footer = hashtag
    ? `${SOURCE_PREFIX}: ${escapeHtml(url)}\n${hashtag}`
    : `${SOURCE_PREFIX}: ${escapeHtml(url)}`;

  const headline = `<b>${escapeHtml(input.title.trim())}</b>`;
  const blocks = [headline, body, footer].filter((block) => block.length > 0);

  return { text: blocks.join("\n\n"), url, headline, body, hashtag };
}

/** The trailing block a cut ends with. */
export function readingNotice(url: string): string {
  return `${READING_NOTICE}: ${escapeHtml(url)}`;
}

/**
 * Trims a string to `limit` without leaving half an entity behind.
 *
 * Only a paragraph longer than a whole message is ever cut mid-text, and the body is
 * escaped by then, so a plain `slice` can land inside `&amp;` and hand Telegram `&am`,
 * which is not an entity it accepts. The check is the cheap one: if the tail has an `&`
 * with no `;` after it, the cut falls back to before that `&`.
 */
function cutWithoutSplittingEntity(text: string, limit: number): string {
  let cut = text.slice(0, limit);
  const lastAmp = cut.lastIndexOf("&");
  if (lastAmp !== -1 && !cut.slice(lastAmp).includes(";")) {
    cut = cut.slice(0, lastAmp);
  }
  return cut.replace(/\s+$/, "");
}

/**
 * Cuts a post down to roughly `LONG_READING_BODY_LIMIT`, on a paragraph boundary.
 *
 * Paragraph boundary rather than character count on purpose: the alternative is a
 * post that ends mid-sentence, and a reader who sees "в结果表明, что правительств" has
 * no way to tell that the sentence was not truncated by the site but by the channel.
 *
 * The ellipsis and the notice are appended to whatever survives, so the returned
 * string is longer than the limit — which is why the limit is 3500 and not 4096.
 */
export function cutForReading(post: MessengerPost): string {
  const paragraphs = post.text.split("\n\n");

  const kept: string[] = [];
  let used = 0;

  for (const paragraph of paragraphs) {
    const cost = paragraph.length + (kept.length > 0 ? 2 : 0);
    // The first paragraph is kept even when it alone is too long. Bailing out on it
    // would return an empty teaser, which tells the reader less than the opening
    // sentence does — and there is nothing else to fall back to.
    if (kept.length > 0 && used + cost > LONG_READING_BODY_LIMIT) break;
    kept.push(paragraph);
    used += cost;
  }

  // Reached only when a single paragraph is longer than the whole budget — a wall of
  // text with no breaks in it. No boundary exists to stop on, so the cut falls back
  // to a character count and the ellipsis below says so.
  let body = kept.join("\n\n");
  if (body.length > LONG_READING_BODY_LIMIT) {
    body = cutWithoutSplittingEntity(body, LONG_READING_BODY_LIMIT);
  }

  return `${body}\n\n...\n\n${readingNotice(post.url)}`;
}

export type TelegramStep =
  /** `sendPhoto`. `caption` is the short caption, or null when there is nothing to put there. */
  | { kind: "photo"; caption: string | null }
  | { kind: "text"; text: string };

export type TelegramPlan = {
  /**
   * Why the plan has the shape it has. Read in logs and asserted in tests.
   *
   * `caption` and `caption-cut` are the two shapes a post with a cover takes: one message,
   * carrying the whole body or a lead cut to fit under the picture. `text-only` and `truncated`
   * are the shapes a post with no cover takes, where there is no picture to hang the words on.
   */
  mode: "caption" | "split" | "chunks" | "truncated" | "text-only";
  steps: TelegramStep[];
  /** Length of the assembled post, before any decision was taken. */
  length: number;
  truncated: boolean;
};

export type PlanOptions = {
  /** False when the article has no cover, so there is no photo to send. */
  hasCover?: boolean;
};

/**
 * The line a cut caption ends with, so the reader knows where the rest of the story is.
 *
 * The brief names this wording, and it is also the shape the site's own posts use, so a
 * caption reads the same whether the reader is looking at the channel or the page.
 */
export const TELEGRAM_CAPTION_MORE = "👉 Читать полностью";

/**
 * What the caption aims for, headline and link included.
 *
 * Not the ceiling: the brief asks for a caption that stays around 900 characters, and a
 * target below the limit is what leaves room for the ellipsis without arithmetic that has to
 * be redone every time the footer changes.
 */
export const TELEGRAM_CAPTION_TARGET = 900;

/**
 * The length this code promises never to exceed.
 *
 * Telegram's own ceiling for a `sendPhoto` caption is `TELEGRAM_CAPTION_LIMIT`, and a caption
 * one character past it is not truncated — the call fails with 400 Bad Request and the post is
 * lost. The margin below it is deliberate: the brief asks for 1000, and the difference is the
 * room a future edit to the footer needs before it becomes a failure in the channel.
 */
export const TELEGRAM_CAPTION_SAFE_LIMIT = 1000;

/**
 * The least of a lead worth printing. Below this the lead is dropped rather than cut to a
 * fragment, because half a clause tells the reader less than the headline and the link do.
 */
const MIN_CAPTION_LEAD = 120;

/** Sentence-ending punctuation, which is where a cut prefers to land. */
const SENTENCE_END = /[.!?…]/;

/**
 * Cuts `text` to at most `limit`, preferring the end of a sentence.
 *
 * A caption that stops mid-word reads as a broken page; one that stops at a full stop reads
 * as an editor's decision. Three fallbacks, in that order, and each one is reached only when
 * the one before it has nothing to offer:
 *
 *   1. the last sentence end — but only past `minimum`, because a boundary in the first part
 *      of the slice would leave a caption of one clause;
 *   2. the last space, under the same condition;
 *   3. the limit itself.
 *
 * The third is what an article with no spaces at all gives — measured, and the reason the
 * condition exists: an earlier version took the last space it could find wherever that was, and
 * a 2500-character body with no spaces after the headline produced a 68-character caption that
 * was the headline and half a word.
 */
function cutAtSentence(text: string, limit: number): string {
  const slice = text.slice(0, limit);
  const minimum = limit * 0.6;

  let at = -1;
  for (let index = slice.length - 1; index >= 0; index -= 1) {
    if (!SENTENCE_END.test(slice[index] ?? "")) continue;
    const next = slice[index + 1];
    if (next === undefined || next === " " || next === "\n") {
      at = index + 1;
      break;
    }
  }

  if (at < minimum) {
    const space = slice.lastIndexOf(" ");
    at = space >= minimum ? space : slice.length;
  }

  const cut = cutWithoutSplittingEntity(slice.slice(0, at), at).trimEnd();
  return cut.length > 0 ? cut : cutWithoutSplittingEntity(slice, limit).trimEnd();
}

/**
 * The caption a photo post carries.
 *
 * **Why a caption and not a second message.** `sendPhoto` takes at most
 * `TELEGRAM_CAPTION_LIMIT` characters, so a longer post used to be sent as the picture with a
 * short caption *and then the text as its own message* — two posts in the channel. Measured on
 * the live channel, that is what an editor sees: the article appears as a wall of text with the
 * picture above it as a separate post, which reads as a post without a cover. One message with
 * the picture attached is what the reader is being promised.
 *
 * The shape is fixed, and it is the brief's:
 *
 *     <b>Заголовок</b>
 *
 *     лид, обрезанный по границе предложения…
 *
 *     👉 Читать полностью: https://…
 *     #Рубрика
 *
 * The lead is measured against the room left by the other three parts, so the promise holds by
 * construction rather than by hoping: the caption is built from a headline, a body cut to fit,
 * a link and a rubric, and only the body has a length nobody controls.
 *
 * Two levels of trimming, and the second exists for input this code does not expect. The lead
 * is first sized for `TELEGRAM_CAPTION_TARGET`; if that leaves less than `MIN_CAPTION_LEAD` it
 * is sized for `TELEGRAM_CAPTION_SAFE_LIMIT` instead, because a caption a little long is better
 * than one that is all headline. Past that the lead is dropped, and only a headline and a link
 * that together exceed the safe limit — which would be a headline to fix, not a caption to
 * mangle — can still push the result over, where the headline is cut rather than the link.
 */
export function buildPhotoCaption(post: MessengerPost): string {
  const linkLine = `${TELEGRAM_CAPTION_MORE}: ${escapeHtml(post.url)}`;
  const tail = post.hashtag ? `${linkLine}\n${post.hashtag}` : linkLine;

  /* Two "\n\n" separators, counted once: they are present whenever a headline meets a lead. */
  const separators = 4;
  const fixed = post.headline.length + tail.length + separators;
  const aim = TELEGRAM_CAPTION_TARGET - fixed;
  const ceiling = TELEGRAM_CAPTION_SAFE_LIMIT - fixed;
  const room = Math.min(Math.max(aim, MIN_CAPTION_LEAD), ceiling);

  const source = post.body.trim();
  const lead =
    source.length === 0 || room <= 0
      ? ""
      : source.length <= room
        ? source
        : `${cutAtSentence(source, room)}…`;

  const caption = [post.headline, lead, tail].filter((block) => block.length > 0).join("\n\n");
  if (caption.length <= TELEGRAM_CAPTION_SAFE_LIMIT) return caption;

  /*
    Reached only by a headline long enough to crowd out everything else. The head is cut rather
    than the tail on purpose: the tail is the link, and half a URL is worse than half a headline.
  */
  const head = cutAtSentence(post.headline, Math.max(0, TELEGRAM_CAPTION_SAFE_LIMIT - tail.length - separators));
  return [head, tail].filter(Boolean).join("\n\n");
}

/**
 * How many messages one article may become before it is cut instead.
 *
 * A long story is sent whole — several `sendMessage` calls rather than one teaser — because
 * "the full text" is the point. The cap is what keeps that from becoming a flood: past four
 * messages the rest is dropped and the usual link to the site stands in.
 */
export const TELEGRAM_MAX_MESSAGES = 4;

/**
 * Splits a post into chunks no longer than Telegram's message ceiling, at paragraph boundaries.
 *
 * Only a paragraph longer than a whole message is cut by character, and that cut is
 * entity-safe: the body is escaped by this point, and half an `&amp;` is not an entity
 * Telegram accepts.
 */
export function chunkForTelegram(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }

    let rest = paragraph;
    while (rest.length > limit) {
      const piece = cutWithoutSplittingEntity(rest, limit);
      const safePiece = piece.length > 0 ? piece : rest.slice(0, limit);
      chunks.push(safePiece);
      rest = rest.slice(safePiece.length).replace(/^\s+/, "");
    }
    current = rest;
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * The caption a cover carries when the whole post will not fit under it: the headline and the
 * link, and nothing else.
 *
 * The full text still follows as its own message or messages. The caption is there so the
 * picture stands on its own — a reader scrolling past sees the headline and where to read the
 * rest, even if the second send is the thing that fails.
 */
export function shortPhotoCaption(post: MessengerPost): string | null {
  const link = `${TELEGRAM_CAPTION_MORE}: ${escapeHtml(post.url)}`;
  // The headline when there is one, and the link alone otherwise: a picture with no caption at
  // all would be a post the reader cannot act on, and `buildMessengerPost` always sets a
  // headline — this branch is for a post assembled by hand.
  const caption = post.headline ? `${post.headline}\n\n${link}` : link;
  return caption.length <= TELEGRAM_CAPTION_LIMIT ? caption : null;
}

/**
 * Decides how a post reaches Telegram.
 *
 * Four shapes, and the first two are the answer to "the full text and the picture":
 *
 *  - **fits under the picture** (`TELEGRAM_CAPTION_LIMIT`): one `sendPhoto` with the whole post
 *    as its caption. One message, which is what a reader and the channel's preview want.
 *  - **longer than that**: the cover with a short caption — headline and link — and then the
 *    **full text** as its own message, or as several split on paragraph boundaries while it
 *    fits in `TELEGRAM_MAX_MESSAGES`. This is the shape the brief asks for: the whole story,
 *    with the picture attached to the post.
 *  - **a post that has become five messages**: the cover, then the teaser pointing at the site.
 *    Past a certain length a channel post is a wall, and the link is the honest end to it.
 *  - **no cover**: the text alone, in the same chunks.
 */
export function planTelegramPost(
  post: MessengerPost,
  { hasCover = true }: PlanOptions = {},
): TelegramPlan {
  const length = post.text.length;

  if (hasCover && length <= TELEGRAM_CAPTION_LIMIT) {
    return {
      mode: "caption",
      length,
      truncated: false,
      steps: [{ kind: "photo", caption: post.text }],
    };
  }

  const steps: TelegramStep[] = [];
  if (hasCover) steps.push({ kind: "photo", caption: shortPhotoCaption(post) });

  if (length <= TELEGRAM_MESSAGE_LIMIT) {
    steps.push({ kind: "text", text: post.text });
    return { mode: hasCover ? "split" : "text-only", length, truncated: false, steps };
  }

  const chunks = chunkForTelegram(post.text, TELEGRAM_MESSAGE_LIMIT);
  if (chunks.length <= TELEGRAM_MAX_MESSAGES) {
    for (const chunk of chunks) steps.push({ kind: "text", text: chunk });
    return { mode: "chunks", length, truncated: false, steps };
  }

  steps.push({ kind: "text", text: cutForReading(post) });
  return { mode: "truncated", length, truncated: true, steps };
}

export type MaxPlan = {
  /**
   * The messages the post becomes, in order. One entry unless the article is longer than a
   * single MAX message, in which case the whole text is continued across several.
   */
  chunks: string[];
  /** Whether the cover should ride on the first message. */
  attachCover: boolean;
};

/**
 * Splits a post into chunks no longer than `limit`, at paragraph boundaries.
 *
 * This is how MAX gets the whole article: `POST /messages` documents `text` as "до 4000
 * символов", and the platform has no long-form article object to hand the overflow to — the
 * attachment types it accepts are image, video, audio, file, sticker, contact, keyboard, share
 * and location. So a story longer than one message is continued rather than cut, and each
 * message ends on a paragraph boundary: a message that stops mid-sentence reads as a truncated
 * one, which is the impression this exists to avoid.
 *
 * Only a single paragraph longer than a whole message is cut by character, and that cut is
 * entity-safe — the body is escaped by this point, and half an `&amp;` is not an entity MAX
 * accepts.
 */
export function chunkForMessenger(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }

    // A paragraph longer than a message on its own. Cut it and keep the remainder as the
    // paragraph to pack from — dropping it is the one thing chunking is meant to avoid.
    let rest = paragraph;
    while (rest.length > limit) {
      const piece = cutWithoutSplittingEntity(rest, limit);
      // A pathological input — an entity longer than the limit — must not loop for ever.
      const safePiece = piece.length > 0 ? piece : rest.slice(0, limit);
      chunks.push(safePiece);
      rest = rest.slice(safePiece.length).replace(/^\s+/, "");
    }
    current = rest;
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Decides how a post reaches MAX.
 *
 * One message when it fits, several when it does not, and the full text either way. The
 * cover is attached to the **first** message, so the post opens with the picture and the
 * headline and continues underneath, which is what "пост с обложкой" means on this platform:
 * MAX takes `text` and `attachments` in a single call, so unlike Telegram there is no caption
 * to fit and no reason to shorten anything.
 */
export function planMaxPost(
  post: MessengerPost,
  { hasCover = true }: PlanOptions = {},
): MaxPlan {
  return {
    chunks: chunkForMessenger(post.text, MAX_MESSAGE_LIMIT),
    attachCover: hasCover,
  };
}