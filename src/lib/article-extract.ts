/**
 * Pulling the article out of another outlet's page.
 *
 * The feeds carry a teaser — measured: URA's `<description>` is 97 characters ending in
 * "Читать далее" — so the rewriter has nothing to work with. This module turns the page
 * the teaser points at into the text of the story.
 *
 * Pure: a string of HTML in, a string of text out, no network. The fetching is next door
 * in feed-fulltext.ts. That split is what makes the interesting part testable — which
 * container is chosen, which lines are boilerplate — without a live request to a
 * newspaper that would rather not be polled by a test suite.
 *
 * The DOM is `jsdom`, and scripts are deliberately not executed: `runScripts` is left
 * unset, which is jsdom's "do not run anything" mode, and subresources are not fetched.
 * A page from an untrusted party is parsed, not run.
 */

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/** Where the body lives, per outlet, then the generic shapes. */
export type BodySelector = { selector: string; note: string };

/**
 * The selectors, ordered.
 *
 * The two outlet entries were found by measuring the real pages rather than by reading
 * the brief: neither site carries `[itemprop="articleBody"]`, `.news-text`, `.story-text`
 * or `[data-testid="article-body"]` — checked, zero matches on both. What they do carry
 * is a CSS-module class whose hash changes on every deploy, so the selector matches the
 * stable prefix (`[class*=…]`) rather than the whole name:
 *
 *   E1    div.articleContent_0DdLJ
 *   66.ru div.news-text
 *
 * URA's entry was removed with the outlet itself. Its class
 * (`content_news-publication-content_…`) is not kept "just in case": a selector that no
 * configured feed can produce is dead weight that reads as support.
 *
 * 66.ru is here for completeness and is not the path that carries that outlet: its pages
 * are assembled by script, and a selector over them finds an empty container. Its text is
 * read from the structured data instead — see `readFromJsonLd`. Measured on a live page:
 * 892 KB of HTML, two `<p>`, one `application/ld+json` block holding the whole body.
 */
export const BODY_SELECTORS: readonly BodySelector[] = [
  { selector: '[class*="articleContent"]', note: "E1.RU" },
  { selector: '.news-text, .story-text, .article__text, .text-block', note: "66.ru и общие имена" },
  { selector: '[itemprop="articleBody"]', note: "schema.org, общий" },
  { selector: '[data-testid="article-body"]', note: "общий data-testid" },
] as const;

/**
 * Below this the container is not a story.
 *
 * A teaser is around a hundred characters; a real body is several paragraphs. The floor
 * exists so that a selector which happens to match a caption block does not win over
 * Readability.
 */
export const MIN_BODY_CHARS = 400;

/** A paragraph shorter than this is a caption, a credit or a stray label, not prose. */
const MIN_PARAGRAPH_CHARS = 25;

/**
 * Containers that hold a picture or an advertisement rather than a paragraph.
 *
 * Every name here was read off a live page, and each is the stable prefix of a
 * CSS-module class (the hash after it changes on every deploy):
 *
 *   URA  image-element_news-content-image-element__Rgxkt   — the caption and the credit
 *   URA  gallery-element_gallery-element__8gZf7            — the photo gallery
 *   URA  inset-element_news-publication-inset-element__EiP2s — "материал по теме"
 *   URA  ad-divider_…, in-page-advertisement_…, ad-block_…  — advertising
 *   E1   articleBlockImage_odoam                           — the caption block
 *
 * A caption is prose, so nothing about its text marks it out; where it sits is the only
 * signal that does not depend on guessing from content.
 */
const MEDIA_CONTAINERS = [
  "news-content-image-element",
  "news-publication-inset-element",
  "gallery-element",
  "articleBlockImage",
  "in-page-advertisement",
  "ad-divider",
  "ad-block",
  "advertisement",
];

/** Elements that are never part of the body, whatever they contain. */
const NON_CONTENT_TAGS = ["FIGURE", "FIGCAPTION", "ASIDE", "FOOTER", "HEADER", "NAV", "FORM"];

/**
 * A block with this few paragraphs is a caption with its credit, not a body.
 *
 * On URA the caption `<p>` and the credit `<p>` "Фото: … © URA.RU" share one
 * `…image-element…` block of exactly two paragraphs. On E1 every body paragraph sits
 * alone in its own block. The guard is what keeps the "shares a block with a credit"
 * rule from firing on Readability's output, where the whole article sits in one wrapper
 * that also holds a `Источник:` line — without it, that rule would delete the story.
 */
const CAPTION_BLOCK_MAX_PARAGRAPHS = 3;

/** A line that identifies a photograph's credit rather than a sentence. */
const CREDITS: RegExp[] = [
  /^фото\s*:/iu,
  /^источник\s*:/iu,
  /^фотография\s*:/iu,
  /^автор\s+(фото|снимка)/iu,
  /©/u,
];

/**
 * Labels and navigation that ride along inside a body's container.
 *
 * Readability alone returned these as paragraphs of the article, so they are filtered by
 * their opening words.
 */
const FURNITURE: RegExp[] = [
  /^подписывайтесь/iu,
  /^подпишитесь/iu,
  /^читайте также/iu,
  /^читайте по теме/iu,
  /^материалы по теме/iu,
  /^материал по теме/iu,
  /^смотрите также/iu,
  /^поделиться/iu,
  /^реклама/iu,
  /^продолжение после рекламы/iu,
  /^комментарии/iu,
  /^оставить комментарий/iu,
  /^больше новостей/iu,
  /^новости по теме/iu,
  /^главные новости/iu,
];

const BOILERPLATE: RegExp[] = [...CREDITS, ...FURNITURE];

/** The tail a feed puts on every teaser. */
const TEASER_TAIL = /^(читать далее|подробнее|читать полностью)[.!…\s]*$/iu;

/** True when the text reads as a photo or agency credit rather than prose. */
function looksLikeCredit(value: string): boolean {
  return CREDITS.some((pattern) => pattern.test(value));
}

/**
 * True when the stored text is a teaser rather than a story.
 *
 * Both signals the brief names, and they catch different things: the length one catches a
 * feed that cuts without saying so, and the phrase one catches a short teaser that
 * happens to be under the limit only because the headline was not counted.
 */
export function looksTruncated(text: string, limit = 250): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length < limit) return true;
  return /читать далее|подробнее|читать полностью/iu.test(trimmed);
}

/**
 * Whether a fetched body is worth replacing the teaser with.
 *
 * The floor is the same one the extractor uses to trust a container: below it, what came
 * back is a caption or a fragment, and swapping a teaser for a fragment would lose the
 * one sentence that was actually about the story. The length comparison is the other
 * half — a fetch that returns less than what is already stored has failed in a way that
 * did not throw, and the teaser is the better of the two.
 */
export function preferExtracted(teaser: string, extracted: string): boolean {
  return extracted.length >= MIN_BODY_CHARS && extracted.length > teaser.trim().length;
}

/** Collapses whitespace inside a line, and nothing else. */
function tidy(value: string): string {
  return value.replace(/[^\S\n]+/g, " ").trim();
}

/** Normalised for comparison: lowercase, no punctuation, single spaces. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drops the furniture from a list of paragraphs.
 *
 * `title` is compared against so a line that repeats the headline is removed — Readability
 * puts the headline in `textContent` on both outlets, and a rewriter handed the headline
 * twice writes it twice. The comparison needs to be against a real headline: a title of a
 * few characters would match half the article, so short titles are ignored.
 */
export function cleanParagraphs(paragraphs: string[], title = ""): string[] {
  const titleKey = comparable(title);
  const titleIsUsable = titleKey.length >= 15;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of paragraphs) {
    const paragraph = tidy(raw);
    if (!paragraph) continue;

    if (paragraph.length < MIN_PARAGRAPH_CHARS) continue;
    if (BOILERPLATE.some((pattern) => pattern.test(paragraph))) continue;
    if (TEASER_TAIL.test(paragraph)) continue;

    const key = comparable(paragraph);
    // The headline, repeated — on its own or with a caption glued onto it.
    if (titleIsUsable && key.includes(titleKey)) continue;

    // A repeated paragraph is a repeated paragraph, not emphasis.
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(paragraph);
  }

  return out;
}

/**
 * The article body, as text with paragraphs on blank lines.
 *
 * Tries the selectors first because they are precise and cheap, and falls back to
 * Readability — which reads the whole document and scores it — when no selector yields
 * enough text. `method` is reported so a caller can log which path was taken; a feed
 * silently switching from selectors to Readability is worth noticing in a log line, and
 * invisible otherwise.
 */
export type ExtractMethod = "ldjson" | "selector" | "readability" | "none";

export function extractArticleText(
  html: string,
  options: { title?: string; url?: string } = {},
): { text: string; method: ExtractMethod; paragraphs: number } {
  if (!html.trim()) return { text: "", method: "none", paragraphs: 0 };

  const dom = new JSDOM(html, { url: options.url ?? "https://example.invalid/" });

  try {
    const fromLd = readFromJsonLd(dom.window.document, options.title);
    const fromSelector = readFromSelectors(dom.window.document, options.title);

    /*
      Служебная разметка идёт первой, и это измерено, а не выбрано по вкусу.

      66.ru отдаёт статью, собранную скриптами: в HTML у неё два абзаца, а весь текст лежит
      в `application/ld+json` полем `articleBody` (проверено на живой странице — 892 КБ HTML,
      два `<p>`, один блок разметки с полным телом). Читать такую страницу селекторами
      значит получить пустоту и решить, что сайт «не поддерживается».

      Но не безусловно: поля расходятся по длине, и побеждает тот путь, который нашёл больше
      текста. Селектор иногда берёт больше — например, когда `articleBody` в разметке
      обрезан до лида.
    */
    const longer = fromLd.text.length > fromSelector.text.length ? fromLd : fromSelector;
    if (longer.text.length >= MIN_BODY_CHARS) return longer;

    const fromReadability = readWithReadability(dom.window.document, options.title);
    if (fromReadability.text.length > longer.text.length) return fromReadability;

    // Neither path produced much: return whatever the cheap paths found, which at least
    // came from a container that looked like an article rather than from a score.
    return longer;
  } finally {
    // jsdom keeps timers and a window alive; on a server that fetches a page per request
    // this is the difference between a leak and a bounded cost.
    dom.window.close();
  }
}

/**
 * Тело статьи, объявленное самой страницей в структурированной разметке.
 *
 * `articleBody` из schema.org — это то, чем издатель называет текст статьи, и потому источник
 * надёжнее любого угадывания по классам. Разметка бывает и массивом, и объектом с `@graph`,
 * поэтому обход рекурсивный: у одного сайта статья в корне, у другого — вложена в список
 * `@graph` вместе с хлебными крошками и организацией.
 *
 * Строка разбирается как JSON только в `try`: битый или неполный блок — обычное дело на живых
 * сайтах, и он не должен ронять извлечение целиком. Второй блок с телом (бывает и такое)
 * сравнивается по длине, как и всё остальное здесь.
 */
function readFromJsonLd(
  document: Document,
  title?: string,
): { text: string; method: ExtractMethod; paragraphs: number } {
  let best: string[] = [];

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }

    for (const node of jsonLdNodes(parsed)) {
      const body = (node as { articleBody?: unknown }).articleBody;
      if (typeof body !== "string") continue;

      const paragraphs = splitLdBody(body);
      if (paragraphs.join(" ").length > best.join(" ").length) best = paragraphs;
    }
  }

  const cleaned = cleanParagraphs(best, title);
  return {
    text: cleaned.join("\n\n"),
    method: cleaned.length > 0 ? "ldjson" : "none",
    paragraphs: cleaned.length,
  };
}

/** Каждый объект внутри разметки: сам узел, элементы массива и всё из `@graph`. */
function jsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (typeof value !== "object" || value === null) return [];

  const graph = (value as { "@graph"?: unknown })["@graph"];
  return [value, ...(graph === undefined ? [] : jsonLdNodes(graph))];
}

/** Тело в разметке — одна строка; абзацами её делают переводы строк. */
function splitLdBody(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The longest candidate container, by the text of its paragraphs. */
function readFromSelectors(
  document: Document,
  title?: string,
): { text: string; method: "selector" | "none"; paragraphs: number } {
  let best: string[] = [];

  for (const { selector } of BODY_SELECTORS) {
    let candidates: Element[];
    try {
      candidates = [...document.querySelectorAll(selector)];
    } catch {
      // A malformed selector in this list is a programming error, not a page problem;
      // skipping it keeps one bad entry from taking the whole extraction down.
      continue;
    }

    for (const candidate of candidates) {
      const paragraphs = collectParagraphs(candidate);
      const chars = paragraphs.join(" ").length;
      if (chars > best.join(" ").length) best = paragraphs;
    }
  }

  const cleaned = cleanParagraphs(best, title);
  return {
    text: cleaned.join("\n\n"),
    method: cleaned.length > 0 ? "selector" : "none",
    paragraphs: cleaned.length,
  };
}

/**
 * Readability's answer, rebuilt from its HTML.
 *
 * `content` rather than `textContent`: Readability hands back cleaned markup, so the
 * paragraphs are still separate elements and can be cleaned one at a time. Its
 * `textContent` is one blob, and a boilerplate line inside it could only be removed by
 * guessing where it ended.
 */
function readWithReadability(
  source: Document,
  title?: string,
): { text: string; method: "readability" | "none"; paragraphs: number } {
  let article: ReturnType<Readability["parse"]> = null;

  try {
    // Readability mutates the document it is given, so it gets a copy. Without this the
    // selector pass above would have run against a document Readability had already
    // rewritten, and the two attempts would not be independent.
    const clone = source.cloneNode(true) as Document;
    article = new Readability(clone).parse();
  } catch {
    return { text: "", method: "none", paragraphs: 0 };
  }

  if (!article?.content) return { text: "", method: "none", paragraphs: 0 };

  const container = new JSDOM(article.content).window.document.body;
  const cleaned = cleanParagraphs(collectParagraphs(container), title || article.title || "");

  return {
    text: cleaned.join("\n\n"),
    method: cleaned.length > 0 ? "readability" : "none",
    paragraphs: cleaned.length,
  };
}

/** A container that is a picture, a gallery or an advertisement, going by its markup. */
function isNonContent(element: Element): boolean {
  if (NON_CONTENT_TAGS.includes(element.tagName)) return true;
  const classes = element.getAttribute("class") ?? "";
  return MEDIA_CONTAINERS.some((token) => classes.includes(token));
}

/** True when the element, or anything above it up to the root, is not content. */
function isInsideNonContent(node: Element, root: Element): boolean {
  let current: Element | null = node.parentElement;
  while (current) {
    if (isNonContent(current)) return true;
    if (current === root) break;
    current = current.parentElement;
  }
  return false;
}

/**
 * True when the paragraph belongs to a small block that carries a photo credit.
 *
 * The credit is what gives the block away: a caption rarely says "Фото: …", but it shares
 * its block with the line that does. The size guard keeps this from firing on a whole
 * article living in one wrapper.
 */
function isCaptionInCreditedBlock(paragraph: Element): boolean {
  const block = paragraph.parentElement;
  if (!block) return false;

  const siblings = [...block.querySelectorAll("p")];
  if (siblings.length === 0 || siblings.length > CAPTION_BLOCK_MAX_PARAGRAPHS) return false;

  return siblings.some((node) => looksLikeCredit((node.textContent ?? "").trim()));
}

/**
 * Every paragraph's text, in document order, without captions or advertising.
 *
 * The order of the two filters matters for readability of the result, not for
 * correctness: dropping the media containers first means the credit check only ever looks
 * at ordinary blocks.
 */
function collectParagraphs(container: Element): string[] {
  const paragraphs = [...container.querySelectorAll("p")];

  if (paragraphs.length === 0) {
    // Some bodies are built from <div> lines rather than <p>: a container with no
    // paragraphs at all still has text, and discarding it would report "nothing found"
    // for a page that plainly has a story.
    return [...container.children]
      .filter((child) => ["DIV", "ARTICLE", "SECTION"].includes(child.tagName))
      .filter((child) => !isNonContent(child))
      .map((child) => child.textContent ?? "");
  }

  const out: string[] = [];
  for (const paragraph of paragraphs) {
    if (isInsideNonContent(paragraph, container)) continue;
    if (isCaptionInCreditedBlock(paragraph)) continue;
    out.push(paragraph.textContent ?? "");
  }
  return out;
}
