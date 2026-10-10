/**
 * The "read also" plate: the markup an editor inserts, and how a body is taken apart
 * around it.
 *
 * **Why the block stores only an identity.** The automatic plate is a React component with
 * Tailwind classes, rendered by the page from a row. A block an editor inserted by hand
 * used the alternative — storing a finished copy of the plate, thumbnail and all — and
 * that means two renderers of one visual thing, which drift the first time either is
 * restyled. It also freezes the data: change the cover and the plate keeps the old
 * photograph forever.
 *
 * So the editor's block is a marker, not a copy: a `<figure class="read-also">` wrapping a
 * single link to the story. The page finds those markers, looks the stories up, and hands
 * each one to the same `ReadAlsoBlock` the automatic plate uses. One renderer, live data,
 * and a story that later disappears still renders as the title the editor gave it rather
 * than vanishing mid-sentence.
 *
 * The marker has to survive `sanitizeArticleHtml`, which is why it is a `figure` with a
 * class and an ordinary `href` and nothing else: `ALLOW_DATA_ATTR` is off on this site, so
 * a `data-slug` would be stripped and the block would be found by nothing.
 */

/** The class that marks both the editor's block and the rendered one. */
export const READ_ALSO_CLASS = "read-also";

/** The kicker the block is always introduced by, on the public page. */
export const READ_ALSO_KICKER = "Читайте также";

/** Prefix a slug's address shares, used to tell a plate link from any other `/news/` link. */
const NEWS_URL_PREFIX = "/news/";

/**
 * The block an editor inserts, as HTML.
 *
 * Only the identity and the title. No cover, no reading time, no rubric: all three are
 * derived at render time from the story the link points at, which is the whole point of
 * not storing a copy. The title is stored anyway, because it is what the block falls back
 * to if the story is ever deleted — a plate that silently disappears from the middle of a
 * paragraph is worse than one whose link 404s.
 */
export function buildReadAlsoHtml(input: {
  slug: string;
  title: string;
}): string {
  const slug = input.slug.trim();
  const title = input.title.trim() || slug;
  if (!slug) return "";

  return (
    `<figure class="${READ_ALSO_CLASS}">` +
    `<a href="${readAlsoHref(slug)}">${escapeHtml(title)}</a>` +
    `</figure>`
  );
}

/** The address a plate points at. */
export function readAlsoHref(slug: string): string {
  return `${NEWS_URL_PREFIX}${slug.trim()}`;
}

/**
 * Escapes the characters that could break out of an attribute or a text node.
 *
 * Exported because the editor's node builds the same structure as a DOM output spec rather
 * than as a string — TipTap serialises that directly, and parsing a finished string back
 * would mean running an HTML parser in the editor for no gain. Two builders of one markup
 * would be one thing to keep in step, so the escaping they share lives here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One marker, as read out of a stored body.
 *
 * `title` is what the anchor said, which is the editor's own wording and the fallback.
 */
export type ReadAlsoMarker = {
  slug: string;
  title: string;
};

/**
 * Reads one marker out of a block of markup, or returns null.
 *
 * Exported for the editor's node, which parses with it; the split below uses the same
 * function so a block the editor sees and a block the page finds can never disagree about
 * what one is.
 */
export function parseReadAlsoMarker(html: string): ReadAlsoMarker | null {
  if (!html.includes(READ_ALSO_CLASS)) return null;

  const anchor = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!anchor) return null;

  const slug = slugFromNewsHref(anchor[1]);
  if (!slug) return null;

  /*
    The anchor must be the figure's whole content, and there must be exactly one figure.

    A plate nested inside a photograph's figure would otherwise be pulled out and leave the
    outer figure empty, which is worse than either block on its own. Counting the opening
    tags is the direct test: a real plate is one `<figure>` wrapping one `<a>`, and
    anything else is not one. The editor's node is a block atom and cannot produce such
    markup, so this guards hand-written and pasted bodies.
  */
  const openings = html.match(/<figure\b/gi)?.length ?? 0;
  if (openings !== 1) return null;

  const withoutFigureTags = html.replace(/<\/?figure[^>]*>/gi, "");
  const withoutAnchor = withoutFigureTags.replace(anchor[0], "");
  if (withoutAnchor.replace(/<[^>]*>/g, "").trim() !== "") return null;

  return { slug, title: stripTags(anchor[2]).trim() || slug };
}

/**
 * A slug from a `/news/<slug>` address, or null.
 *
 * The path is checked in full rather than with a `^/news/` prefix alone, so a link such as
 * `/newsletter/advert` cannot be mistaken for a plate pointing at «advert».
 */
export function slugFromNewsHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith(NEWS_URL_PREFIX)) return null;

  const slug = trimmed.slice(NEWS_URL_PREFIX.length).split(/[/?#]/)[0] ?? "";
  return /^[a-z0-9-]+$/i.test(slug) ? slug : null;
}

/** The text of a fragment, without its tags. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** A body, taken apart into what renders between and instead of the plates. */
export type ReadAlsoBody =
  | { kind: "body"; html: string }
  | { kind: "readAlso"; slug: string; title: string };

/**
 * How deep a nested `<figure>` may go before it stops being searched.
 *
 * Bounded so a hand-edited body with an unclosed figure cannot make the scan quadratic on
 * a long article. Nobody nests figures in prose, and TipTap never emits one.
 */
const MAX_SCAN_DEPTH = 8;

/**
 * Splits a body at every plate marker, in document order.
 *
 * Returns a single `body` part when there is no marker, so the caller does not need a
 * separate branch for the common case. Empty parts are kept rather than dropped: an empty
 * `body` part renders as an empty container, which is harmless, and dropping them would
 * make the indices stop lining up with the markers.
 */
export function splitAroundReadAlso(html: string): ReadAlsoBody[] {
  const parts: ReadAlsoBody[] = [];
  let cursor = 0;
  let depth = 0;
  let index = 0;

  while (index < html.length) {
    /*
      A marker is a *top-level* figure that carries a story link. Checked before the depth
      counter moves, not after: counting the opening tag first would put every figure at
      depth 1 and the marker branch below would never be reached — which is exactly what
      happened, and what made this return the whole body as one part.
    */
    if (depth === 0 && html.startsWith("<figure", index)) {
      const end = findFigureEnd(html, index);
      const marker = parseReadAlsoMarker(html.slice(index, end));

      if (marker) {
        const before = html.slice(cursor, index);
        if (before.trim()) parts.push({ kind: "body", html: before });

        parts.push({ kind: "readAlso", ...marker });
        cursor = end;
        index = end;
        continue;
      }

      // An ordinary figure — a photograph, a quote. Skipped whole rather than walked,
      // so a plate nested inside one of them cannot be pulled out of its parent.
      index = end;
      continue;
    }

    if (html.startsWith("<figure", index)) {
      depth += 1;
      index += 7;
      continue;
    }

    if (html.startsWith("</figure>", index)) {
      depth = Math.max(0, depth - 1);
      index += 9;
      continue;
    }

    index += 1;
  }

  const rest = html.slice(cursor);
  if (!rest.trim() && parts.length === 0) {
    return rest ? [{ kind: "body", html: rest }] : [];
  }
  if (rest) parts.push({ kind: "body", html: rest });

  return parts;
}

/** Where the `<figure>` opening at `start` closes, or the end of the string. */
function findFigureEnd(html: string, start: number): number {
  let depth = 0;
  let index = start;

  while (index < html.length && depth <= MAX_SCAN_DEPTH) {
    if (html.startsWith("<figure", index)) {
      depth += 1;
      index += 7;
      continue;
    }
    if (html.startsWith("</figure>", index)) {
      depth -= 1;
      index += 9;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }

  return html.length;
}

/** True when a body carries a plate the editor put there by hand. */
export function hasManualReadAlso(html: string): boolean {
  return splitAroundReadAlso(html).some((part) => part.kind === "readAlso");
}

/**
 * Whether the page should place a plate of its own.
 *
 * Both conditions are load-bearing, and the second is the one that is easy to miss.
 *
 * The first is the article's flag, which the desk clears when the automatic position is
 * wrong for this piece — typically because the second and third paragraphs are a
 * quotation and a correction, where any interruption lands badly.
 *
 * The second is that the editor has not already put one in. Without it a body could
 * carry both, and the reader would meet two plates in one article: one at a position the
 * site chose and one at a position a person chose. The hand-placed one always wins,
 * because it is the one somebody actually decided on.
 *
 * `manualCount` is passed rather than the body so the page can answer this from the split
 * it has already done, and so the rule stays a decision instead of becoming a scan.
 */
export function automaticPlateAllowed(
  autoRelatedArticle: boolean,
  manualCount: number,
): boolean {
  return autoRelatedArticle && manualCount === 0;
}