/**
 * Body photographs are delivered through the image optimiser, not from disk.
 *
 * **Why.** A photograph inside a story is a plain `<img>` in the article HTML. `next/image`
 * does that job for every cover and card, but the body is a string handed to the browser
 * as-is, so the stored file was downloaded at full size: measured on 2026-11-25, one
 * article carried 1.2 MB, 769 KB and 624 KB JPEGs. Re-encoding at upload brought the stored
 * copies down to ~300–500 KB, and the PNGs that could not change format (a screenshot
 * re-encoded as PNG stays heavy — up to 1.4 MB) cannot be fixed that way at all without
 * renaming files the database points at.
 *
 * The optimiser is already the delivery path for covers, so pointing body images at it
 * needs no new machinery: `/_next/image?url=…&w=1200&q=75` answers with WebP at the asked
 * width, cached on disk for a month (`minimumCacheTTL`). A 1.2 MB PNG becomes roughly
 * 150–200 KB, and the article's HTML does not change shape — the `<img>`, its `alt`, its
 * figure and its caption stay exactly where the editor put them.
 *
 * **What is left alone, on purpose.**
 *
 *  - Anything not under `/uploads/` — a stock photograph from Unsplash, an editor's external
 *    link. Those hosts are outside this server and rewriting them would put the optimiser
 *    in the middle of somebody else's CDN for no gain.
 *  - A URL that already points at the optimiser, so the transform is idempotent.
 *  - A `src` with a query string or a `#`, which is not a filename this server owns.
 *  - Data URIs and SVG, which the optimiser refuses (`dangerouslyAllowSVG` is off).
 *
 * The transform runs on the *sanitised* body, so it can only ever see markup that already
 * passed `sanitizeArticleHtml`.
 */

/** Valid `w` values are Next's own `deviceSizes`; 1200 is the closest to a 2× body column. */
export const BODY_IMAGE_WIDTH = 1200;

/** Quality used by `next/image` by default; stated so the URL is readable. */
export const BODY_IMAGE_QUALITY = 75;

/** A stored file this server owns and the optimiser can read. */
const LOCAL_UPLOAD = /^\/uploads\/[^"'\s?#<>]+\.(?:jpe?g|png|webp)$/i;

/** The `src` of one `<img>`, double- or single-quoted as the sanitiser leaves it. */
function srcOf(tag: string): { attribute: string; value: string } | null {
  /*
    The lookbehind is load-bearing: `\bsrc=` also matches `data-src=` and `srcset`-adjacent
    names, because a hyphen is a word boundary. Without it a lazy-loading attribute would be
    rewritten while the real `src` stayed as it was.
  */
  const match = /(?<![-\w])src\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
  if (!match) return null;
  return { attribute: match[0], value: match[2] ?? match[3] ?? "" };
}

/**
 * Rewrites the local photographs in an article body to optimiser URLs.
 *
 * A pure string function: no database, no filesystem, so the rules above are asserted in
 * `image:check` against literal markup rather than through a running site.
 */
export function optimiseBodyImages(html: string): string {
  if (!html.includes("/uploads/")) return html;

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = srcOf(tag);
    if (!src || !LOCAL_UPLOAD.test(src.value)) return tag;

    const optimised =
      `/_next/image?url=${encodeURIComponent(src.value)}` +
      `&w=${BODY_IMAGE_WIDTH}&q=${BODY_IMAGE_QUALITY}`;

    return tag.replace(src.attribute, `src="${optimised}"`);
  });
}
