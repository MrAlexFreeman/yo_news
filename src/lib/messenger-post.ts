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

/**
 * Прежняя строка кредита была «Ё-новости: <адрес>». Она ушла вместе с сырым адресом: канал
 * называется «Ё-новости», и приписка перед ссылкой читалась как «Ё-новости: читать полностью
 * на сайте». Само кредитование осталось — им стала ссылка с понятными словами.
 */

/** Appended after a cut, in place of the missing paragraphs. */
const READING_NOTICE = "📖 Полный текст расследования читайте на сайте";

/**
 * Ссылка в подвале поста — словами, а не адресом.
 *
 * Сырой адрес занимал три строки на телефоне: «👉 Читать полностью:
 * https://eartnews.ru/news/sverdlovchane-posle-anomalnyh-…». Читатель узнаёт из этого
 * ровно одно — что ссылка длинная; что за материал и куда он ведёт, видно только после
 * нажатия.
 *
 * Разметка не украшение, а требование площадки. Telegram принимает подпись и текст только с
 * `parse_mode: "HTML"` и поддерживает подмножество тегов, где `<a href>` — штатный способ
 * показать ссылку. MAX то же самое: в документации `format: "html"` и `<a href="…">Текст</a>`
 * перечислены как способы отправки ссылки. Поэтому один и тот же текст годится обоим, и
 * разбирать его получателю не нужно.
 *
 * Слово «Ё-новости» из прежней строки ушло: канал и так называется, а приписка перед ссылкой
 * превращала фразу в «Ё-новости: читать полностью на сайте». Кто угодно печатающий наш адрес,
 * получает теперь ссылку с понятным текстом и без лишнего префикса.
 */
export function readMoreLink(url: string, label = "Читать полностью на сайте"): string {
  return `👉 <a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

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
 * Экранирование для значения HTML-атрибута.
 *
 * `escapeHtml` не трогает кавычки — они безопасны в тексте, но не внутри `href="…"`. Адрес
 * берётся из настроек сайта и из слага, то есть из данных, которые редактор не пишет
 * руками; всё равно, одна непарная кавычка в адресе закрыла бы атрибут и утащила в разметку
 * остальную строку поста.
 */
export function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    The link and the rubric tag share one block, joined by a single newline rather
    than a blank line. They are one thought — where this came from and what it is
    filed under — and a blank line between them reads as the start of a new section in
    a post that is otherwise a wall of paragraphs.

    The credit line became the link itself: it used to be «Ё-новости: https://…», which on a
    phone wrapped over three lines and told the reader nothing except that the address was long.
    Now it is one line with the address hidden behind the words — see `readMoreLink`.
  */
  const linkLine = readMoreLink(url);
  const footer = hashtag ? `${linkLine}\n${hashtag}` : linkLine;

  const headline = `<b>${escapeHtml(input.title.trim())}</b>`;
  const blocks = [headline, body, footer].filter((block) => block.length > 0);

  return { text: blocks.join("\n\n"), url, headline, body, hashtag };
}

/** The trailing block a cut ends with. */
export function readingNotice(url: string): string {
  return `${READING_NOTICE}: ${readMoreLink(url)}`;
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

  /*
    И не разрезать тег.

    В посте есть живые `<a href>` в подвале, и обрезка по символам иногда попадает внутрь него —
    когда абзац не помещается в лимит сам по себе. Разрезанный `<a href="https://…` без
    закрытия не «покажется как текст», а отклонит всё сообщение целиком: Telegram и MAX
    разбирают только известное подмножество HTML и отвечают «can't parse entities» на непарный
    тег, а не на конкретный. Откат до последней `<` перед точкой реза стоит нескольких
    символов и превращает отказ сообщения в обычную потерю хвоста.
  */
  const lastOpen = cut.lastIndexOf("<");
  if (lastOpen !== -1 && !cut.slice(lastOpen).includes(">")) {
    cut = cut.slice(0, lastOpen);
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
  /** `sendPhoto`. `caption` is the whole post, when it fits under the picture. */
  | { kind: "photo"; caption: string | null }
  /**
   * `sendMessage`. `previewUrl` is the cover's absolute address, embedded as an invisible
   * zero-width link so Telegram renders it as a large preview above the text; null when there
   * is no cover to preview.
   */
  | { kind: "text"; text: string; previewUrl: string | null };

export type TelegramPlan = {
  /**
   * Why the plan has the shape it has. Read in logs and asserted in tests.
   *
   * `caption` — the whole post fits under the photo, sent as one `sendPhoto`. `preview` — the
   * post is one message long, sent as `sendMessage` with the cover as a link preview. `text-only`
   * — no cover, one plain message. `truncated` — too long for one message, sent as a teaser
   * pointing at the site.
   *
   * There is no "two messages" shape. It used to exist — the cover first, then the text — and it
   * read in the channel as a picture with a wall of text dropped after it. One story, one message.
   */
  mode: "caption" | "preview" | "text-only" | "truncated";
  steps: TelegramStep[];
  /** Length of the assembled post, before any decision was taken. */
  length: number;
  truncated: boolean;
};

export type PlanOptions = {
  /** False when the article has no cover, so there is no photo to send. */
  hasCover?: boolean;
  /**
   * The cover's absolute URL, for the link-preview message. Ignored unless `hasCover` is true.
   */
  coverUrl?: string | null;
};

/**
 * Невидимая ссылка на обложку, которую Telegram развернёт в полноразмерное фото сверху поста.
 *
 * Текст ссылки — U+200B, нулевая ширина: в канале она не видна, но это первая ссылка в сообщении,
 * и именно её Telegram берёт для предпросмотра. Так длинный пост получает обложку без второго
 * сообщения: `sendMessage` с `link_preview_options` рисует фото над текстом, а не после него.
 */
export function coverPreviewLink(url: string): string {
  return `<a href="${escapeAttribute(url)}">&#8203;</a>`;
}

/**
 * Decides how a post reaches Telegram. Always one message.
 *
 * The old two-message shape — the cover first, then the text — is gone. It read in the channel as
 * a picture with a wall of text dropped after it, and the editor asked for it back. Three shapes:
 *
 *  - **fits under the picture** (`TELEGRAM_CAPTION_LIMIT`): one `sendPhoto` with the whole post
 *    as its caption.
 *  - **one message long** (`TELEGRAM_MESSAGE_LIMIT`): one `sendMessage`. With a cover, its URL
 *    rides in `previewUrl`, so Telegram attaches a large preview above the text.
 *  - **longer than one message**: one `sendMessage` with the teaser and the link to the site. A
 *    story past 4096 characters is a wall; the honest end to it is the link.
 */
export function planTelegramPost(
  post: MessengerPost,
  { hasCover = true, coverUrl = null }: PlanOptions = {},
): TelegramPlan {
  const length = post.text.length;
  const preview = hasCover && coverUrl ? coverUrl : null;

  if (hasCover && length <= TELEGRAM_CAPTION_LIMIT) {
    return {
      mode: "caption",
      length,
      truncated: false,
      steps: [{ kind: "photo", caption: post.text }],
    };
  }

  if (length <= TELEGRAM_MESSAGE_LIMIT) {
    return {
      mode: hasCover ? "preview" : "text-only",
      length,
      truncated: false,
      steps: [{ kind: "text", text: post.text, previewUrl: preview }],
    };
  }

  return {
    mode: "truncated",
    length,
    truncated: true,
    steps: [{ kind: "text", text: cutForReading(post), previewUrl: preview }],
  };
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