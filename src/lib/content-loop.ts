/**
 * The engagement loop on an article page: a "read also" plate inside the body, a
 * six-card grid under it, a "most read" rail in the sidebar.
 *
 * Everything here is pure. The page fetches rows and hands them over; deciding *where*
 * the plate goes, *which* story goes in it and *how the two rows are made up* is a
 * function of the markup and the ids alone. That is what makes the whole loop testable
 * without a database — and, more importantly, stable.
 *
 * Stable matters here. These pages are ISR-cached for five minutes and regenerated in
 * two different processes, so anything random would make the cached HTML disagree with
 * the next render: the plate would move between requests, and the six cards under it
 * would reshuffle themselves for no editorial reason. Every choice below is therefore a
 * hash of the article id — varied between stories, identical for the same story.
 */

/**
 * Where the plate may go, in paragraphs.
 *
 * The second and the third are the only two positions that read as "in the middle": in
 * the first the reader has no context yet, and after the fourth the article is nearly
 * over, which makes a detour at exactly the moment someone is about to leave.
 */
export const LOOP_PLACEMENTS = [2, 3] as const;

/**
 * Below this the plate is not inserted at all.
 *
 * Two paragraphs have no middle: anything inserted between them is either at the top,
 * where the reader has nothing to relate it to, or at the very end, where it is not a
 * way further in but a wall. A one-paragraph body is a short brief, and a brief that
 * grows a callout box is worse than a brief.
 */
export const MIN_PARAGRAPHS_FOR_LOOP = 3;

/** FNV-1a: small, fast, and stable across Node versions and platforms. */
export function stableHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A deterministic index into `length` items; 0 for an empty range. */
export function stableIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  return stableHash(seed) % length;
}

/** The item this story points at, or null when there is nothing to point at. */
export function pickStable<T>(items: readonly T[], seed: string): T | null {
  return items.length === 0 ? null : items[stableIndex(seed, items.length)] ?? null;
}

/**
 * Paragraph closings, in document order.
 *
 * `</p>` cannot appear inside `<pre>` or `<code>` as a real tag — the sanitiser escapes
 * text content, so a pasted code sample holds `&lt;/p&gt;` — which is what makes a
 * plain scan safe here. A `<p>` nested in a `<blockquote>` still counts, and counts in
 * the position a reader sees it, which is the position the plate needs.
 */
const PARAGRAPH_CLOSE = /<\/p\s*>/gi;

export function countParagraphs(html: string): number {
  return html.match(PARAGRAPH_CLOSE)?.length ?? 0;
}

export type BodySplit = { before: string; after: string };

/**
 * Cut the body after the `position`-th paragraph.
 *
 * The cut lands immediately after a closing tag, so both halves are complete documents
 * and either can be rendered on its own. That is the whole reason for splitting here
 * rather than injecting a string: the plate can then be a real component with real
 * Tailwind classes, and the body keeps rendering through the same sanitiser as before.
 */
export function splitAfterParagraph(html: string, position: number): BodySplit | null {
  if (position < 1) return null;

  const closings = Array.from(html.matchAll(PARAGRAPH_CLOSE));
  const closing = closings[position - 1];
  if (!closing || closing.index === undefined) return null;

  const cut = closing.index + closing[0].length;
  return { before: html.slice(0, cut), after: html.slice(cut) };
}

/**
 * Which paragraph the plate follows for this story, or null when it does not fit.
 *
 * The choice between the two positions is hashed per article, so neighbouring stories
 * in the same rubric do not all interrupt at the same sentence.
 */
export function placementFor(
  articleId: string,
  paragraphCount: number,
): number | null {
  if (paragraphCount < MIN_PARAGRAPHS_FOR_LOOP) return null;

  const choices = LOOP_PLACEMENTS;
  const choice = choices[stableIndex(`${articleId}:placement`, choices.length)] ?? choices[0];

  // Always leave at least one paragraph after the plate.
  return Math.min(choice, paragraphCount - 1);
}

/** The split for this story, or null when the body is too short to carry a plate. */
export function splitForLoop(
  html: string,
  articleId: string,
): BodySplit | null {
  const position = placementFor(articleId, countParagraphs(html));
  return position === null ? null : splitAfterParagraph(html, position);
}

/**
 * Fill two rows of `size` cards from two candidate lists.
 *
 * Three things have to hold at once, and handling them in order is the design:
 *
 * 1. Nothing already on the page repeats. The current story and the plate's pick are
 *    excluded from both rows — a reader who has just been offered a story and then sees
 *    it again in the grid is being told the page has nothing else, which is exactly the
 *    impression the loop exists to avoid.
 * 2. No id appears twice, across the two rows as well as within them.
 * 3. Neither row is left short while an unused story exists. A two-row grid with a hole
 *    in it reads as a failed request, so the leftovers from either list refill both rows,
 *    and they go to whichever row is behind — a row of one card beside a row of three
 *    reads worse than a row of two beside a row of two. When there is not enough
 *    material for both rows, they are filled evenly and left short together.
 *
 * Generic over the row type: the page passes database rows, the tests pass literals.
 */
export function composeLoopRows<T extends { id: string }>(
  popular: readonly T[],
  highlights: readonly T[],
  excludeIds: readonly (string | null | undefined)[],
  size: number,
): { popular: T[]; highlights: T[] } {
  if (size <= 0) return { popular: [], highlights: [] };

  const blocked = new Set(
    excludeIds.filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const taken = new Set<string>();

  const first: T[] = [];
  for (const row of popular) {
    if (first.length === size) break;
    if (blocked.has(row.id) || taken.has(row.id)) continue;
    first.push(row);
    taken.add(row.id);
  }

  // Everything still on offer, highlights first: the rest of the day is the better
  // filler for the popular row when the rubric itself runs dry.
  const second: T[] = [];
  for (const row of [...highlights, ...popular]) {
    if (first.length >= size && second.length >= size) break;
    if (blocked.has(row.id) || taken.has(row.id)) continue;
    taken.add(row.id);

    // Into whichever row is behind: a row of one card beside a row of three reads
    // worse than a row of two beside a row of two.
    (second.length <= first.length ? second : first).push(row);
  }

  return { popular: first, highlights: second };
}