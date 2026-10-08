/**
 * Which pictures an article already has, for the "choose from the article" list in the
 * insert-photo dialog.
 *
 * Pure, and separate from the dialog, because "what counts as already in this article"
 * is a question with several answers and the interesting part is where they disagree:
 * the cover is a picture the article uses but which lives outside the body; the gallery
 * holds pictures that may never have been placed in the text; and the body holds
 * pictures that may have been pasted from anywhere at all, including other sites.
 *
 * The list is for an editor picking a file they have already uploaded, so anything that
 * could not be re-used verbatim is left out rather than shown and then rejected.
 */

import { UPLOAD_URL_PREFIX } from "@/lib/upload-dir";

export type ArticleImage = {
  url: string;
  /** Where it came from, so the dialog can group or label the list. */
  source: "body" | "gallery" | "cover";
  /** True for a file this site serves from its own upload directory. */
  local: boolean;
};

/** Shape of a gallery entry, as stored in the `media` JSON column. */
type MediaLike = { url?: unknown };

/**
 * True for a URL that could be pasted into an `<img src>` and load.
 *
 * The site's own uploads, and absolute http(s) addresses. Everything else — a data
 * URI, a protocol-relative `//host/x`, a `javascript:` URL — is dropped: the first
 * would bloat the article row, and the last two would be a link the sanitiser strips
 * anyway, so offering them would be offering a choice that cannot be made.
 */
export function isUsableImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(UPLOAD_URL_PREFIX)) return !trimmed.includes("..");
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

/** Every `/uploads/…` address in a fragment of body HTML, in the order it appears. */
export function uploadsInHtml(html: string): string[] {
  const found = html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi);
  return [...found].map((match) => match[1] ?? "").filter((url) => isUsableImageUrl(url));
}

/**
 * The pictures the article already has, de-duplicated, newest source first.
 *
 * Order matters for the list's usefulness: the gallery and the cover are what the
 * editor uploaded deliberately, so they come before whatever happens to be embedded in
 * the text. A picture that is in both the body and the gallery appears once.
 */
export function collectArticleImages(input: {
  html?: string;
  media?: MediaLike[] | null;
  coverImage?: string | null;
}): ArticleImage[] {
  const seen = new Map<string, ArticleImage>();

  const add = (url: string, source: ArticleImage["source"]) => {
    const trimmed = url.trim();
    if (!isUsableImageUrl(trimmed) || seen.has(trimmed)) return;
    seen.set(trimmed, { url: trimmed, source, local: trimmed.startsWith(UPLOAD_URL_PREFIX) });
  };

  for (const item of input.media ?? []) {
    if (typeof item?.url === "string") add(item.url, "gallery");
  }
  if (typeof input.coverImage === "string") add(input.coverImage, "cover");
  for (const url of uploadsInHtml(input.html ?? "")) add(url, "body");

  return [...seen.values()];
}

/**
 * A readable name for a picture in the list.
 *
 * The stored URL is a UUID, so it tells an editor nothing. What distinguishes two
 * photos in a list is where each came from, which is the only thing known without
 * loading them — the caption belongs to the text, not to the file.
 */
export function imageLabel(image: ArticleImage): string {
  if (image.source === "cover") return "Обложка статьи";
  const filename = image.url.split("/").pop() ?? image.url;
  return image.source === "gallery" ? `Из галереи: ${filename}` : `Уже в тексте: ${filename}`;
}
