import { DOMPurify, setFeedBase, withPolicy } from "@/lib/dompurify";

import {
  meetsDzenMinimum,
  type MediaItem,
} from "@/lib/article-media";

/**
 * Article body in the exact subset of HTML Dzen accepts inside
 * `<content:encoded>`.
 *
 * This is deliberately *not* `sanitizeArticleHtml`. That allowlist is wider than
 * Dzen's: it keeps tables, `pre`, `div`, `span` and video iframes, none of which
 * Dzen renders. Its own words — «Все параметры, предназначенные для
 * дополнительного оформления и сложной вёрстки, не обрабатываются» — mean the
 * extras are silently dropped on their side, so an editor who typed a table would
 * watch half the story disappear after syndication. Narrowing the markup here
 * makes the feed WYSIWYG instead of lossy.
 *
 * Dzen's supported set, from https://dzen.ru/help/ru/website/rss-modify.html:
 * p, a, b, i, u, s, h1–h4, blockquote, ul/li, ol/li, figure/img/figcaption, video.
 */
const DZEN_TAGS = [
  "p", "br",
  "h1", "h2", "h3", "h4",
  "b", "i", "u", "s",
  "blockquote",
  "ul", "ol", "li",
  "a", "figure", "img", "figcaption",
];

/**
 * Only URL-bearing and descriptive attributes survive. `class`, `style` and `id`
 * are dropped on purpose: Dzen ignores presentation, so shipping them only makes
 * the payload larger against a documented 10 MB ceiling.
 */
const DZEN_ATTR = ["href", "src", "alt"];

/** Absolute URL for a site-relative path; http(s) URLs pass through untouched. */
function absolutize(url: string, base: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  return `${base}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/**
 * Names of hosts Dzen turns a bare link into a video widget.
 *
 * Per the docs the link itself is what matters: «RSS-лента автоматически
 * превращает в виджет следующие ссылки: Видео Дзена, VK Видео, YouTube». An
 * iframe would not be understood, so the feed ships a plain <a>.
 */
function videoLink(value: string, base: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.replace(/^www\./, "");
    const supported =
      host === "youtu.be" ||
      host.endsWith("youtube.com") ||
      host === "rutube.ru" ||
      host === "vk.com" ||
      host === "vk.ru" ||
      host.endsWith("vkvideo.ru");
    return supported ? absolutize(trimmed, base) : null;
  } catch {
    return null;
  }
}

/** `<figure>` for one image, in the shape Dzen documents. */
function figure(url: string, caption: string, source: string): string {
  const alt = escapeAttribute(caption || source);
  const credit = [caption, source].filter(Boolean).join(". ");

  return [
    "<figure>",
    `<img src="${escapeAttribute(url)}" alt="${alt}" />`,
    credit ? `<figcaption>${escapeText(credit)}</figcaption>` : "",
    "</figure>",
  ]
    .filter(Boolean)
    .join("");
}

/** Dzen strips whatever presentation an attribute carries, so escape it well. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text inside figcaption, which carries no attribute quoting to worry about. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** First <img src> in a chunk of HTML, compared case-insensitively. */
function firstImageUrl(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

export type DzenContentInput = {
  title: string;
  subtitle: string | null;
  contentHtml: string;
  coverImage: string | null;
  gallery: MediaItem[];
  videoUrl: string | null;
  base: string;
};

/**
 * Builds the HTML that goes inside `<content:encoded>`.
 *
 * Structure follows Dzen's own item example and its stated rules:
 *
 * - The headline is repeated as an `<h1>` because «этот тег обязателен, но
 *   игнорируется при конвертации материала в пост. Если вы хотите, чтобы
 *   заголовок отображался в посте, продублируйте его внутри content:encoded».
 * - The cover comes first as a `<figure>`, because «первое изображение в статье
 *   появится на карточке» — the same URL is already the `<enclosure>`.
 * - Gallery images follow as `<figure><img><figcaption>`. They are deliberately
 *   *not* extra enclosures: Dzen documents `enclosure` as the cover/medialock
 *   image that «не отображается внутри текста публикации», so an enclosure per
 *   gallery photo would add weight without adding a picture.
 * - Anything below Dzen's 480×320 is dropped rather than shipped: «если
 *   изображение пришло в некорректном формате, материал будет опубликован без
 *   картинки» — one bad picture costs the whole publication its media.
 * - The video is a plain link, which is what Dzen converts into a widget.
 */
export function buildDzenContent(input: DzenContentInput): string {
  const { base } = input;

  // Phase 1: narrow the body to the supported subset and make its URLs absolute.
  //
  // The attribute hook is shared with the article sanitiser and branches on a
  // policy flag rather than being installed here — two hooks on one global
  // DOMPurify instance would unhook each other, and that already cost the public
  // pages their data-URI and iframe-host guards for a whole request cycle.
  setFeedBase(base);
  const body = withPolicy("dzen", () =>
    DOMPurify.sanitize(input.contentHtml, {
      ALLOWED_TAGS: DZEN_TAGS,
      ALLOWED_ATTR: DZEN_ATTR,
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
      FORBID_TAGS: ["script", "style", "form", "input", "table", "pre", "code", "video"],
      FORBID_ATTR: ["style", "class", "id", "target", "rel", "width", "height"],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    }),
  );

  const seenUrls = new Set<string>();
  for (const match of body.matchAll(/<img[^>]+src="([^"]*)"/gi)) {
    seenUrls.add(match[1].replace(/&amp;/g, "&").toLowerCase());
  }

  const blocks: string[] = [];

  // Headline first, unless the body already opens with its own heading — the
  // editor's <h1> outranks ours.
  if (!/^\s*<h1[\s>]/i.test(body)) {
    blocks.push(`<h1>${escapeText(input.title)}</h1>`);
    if (input.subtitle?.trim()) {
      blocks.push(`<h2>${escapeText(input.subtitle.trim())}</h2>`);
    }
  }

  // The cover doubles as the card image, so it has to be the first figure.
  const cover = input.coverImage?.trim();
  if (cover) {
    const url = absolutize(cover, base);
    if (!seenUrls.has(url.toLowerCase()) && firstImageUrl(body) !== url) {
      blocks.push(figure(url, input.title, ""));
      seenUrls.add(url.toLowerCase());
    }
  }

  blocks.push(body);

  // Gallery, in editorial order, minus anything already in the text or the cover.
  for (const item of input.gallery) {
    const url = absolutize(item.url, base);
    const key = url.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (!meetsDzenMinimum({ ...item, url })) continue;
    blocks.push(figure(url, item.caption, item.source));
  }

  // Video as a plain link. Skipped when the body already links it, because Dzen
  // would then render the widget twice.
  const video = input.videoUrl ? videoLink(input.videoUrl, base) : null;
  if (video && !body.toLowerCase().includes(video.toLowerCase())) {
    blocks.push(`<p><a href="${escapeAttribute(video)}">Смотреть видео</a></p>`);
  }

  return blocks.filter((block) => block.trim().length > 0).join("");
}