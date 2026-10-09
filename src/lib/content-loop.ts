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
 * Top a ranked list up from a second one, without repeating anything.
 *
 * The sidebar's "most read right now" is a five-row list, and it is drawn from a
 * two-day window. A quiet news day puts two stories in that window — the site publishes
 * three or four a day — and the block then rendered two rows under a heading that
 * promises a top five, which reads as a broken widget rather than as a quiet day.
 *
 * So the window decides the order and the all-time list only makes up the numbers: a
 * story from the last 48 hours always outranks an all-time favourite, because "сейчас"
 * is the claim the heading makes. Duplicates are dropped rather than reordered, so a
 * story already in the window does not appear twice once the filler reaches it.
 *
 * `size` is a target, not a promise: a site with four published stories other than the
 * one being read returns four, because there is no fifth to return.
 *
 * `used` is the page's shared "already on screen" set, and it is optional only so the
 * sidebar, which has no front page to share state with, can keep calling this with three
 * arguments. It is not optional in practice, and leaving it off was a real bug: measured on
 * the live front page, the AI-95 story was linked three times — once as the lead, once in
 * «Важное» and once in «Спецтема» — because each of those two blocks built its own private
 * `taken` set and never heard of the lead. The internal set is still needed to keep the
 * block from repeating itself between its two candidate lists; it is now seeded from the
 * page's set rather than replacing it.
 *
 * Generic over the row type: the page passes database rows, the tests pass literals.
 */
export function fillRanked<T extends { id: string }>(
  primary: readonly T[],
  fallback: readonly T[],
  size: number,
  used?: Set<string>,
): T[] {
  if (size <= 0) return [];

  const taken = new Set<string>(used);
  const result: T[] = [];

  for (const row of [...primary, ...fallback]) {
    if (result.length === size) break;
    if (taken.has(row.id)) continue;
    taken.add(row.id);
    result.push(row);
  }

  if (used) {
    for (const row of result) used.add(row.id);
  }

  return result;
}

/**
 * One rubric strip's cards: its own stories first, topped up from a shared pool.
 *
 * A rubric strip is a full row or it is a hole. A section whose only story is a single
 * card leaves the other three columns of a 1280px page empty, which reads as a broken
 * layout rather than as a quiet rubric — and this site has seven rubrics of which one
 * carries everything, so "its own stories only" would print one card per row for most of
 * the front page.
 *
 * So the row is filled to `size` from the pool of material the page has not shown yet.
 * The filler is not passed off as the rubric it sits under: every card prints its own
 * rubric above its headline, so a reader looking at «Происшествия» sees «ОБЩЕСТВО» on the
 * stories that came from elsewhere. The heading promises a desk, the cards name their own.
 *
 * `used` is shared across sections and mutated on purpose. It is the single place where
 * "a story appears once on the front page" is decided, and threading a return value
 * through every section in turn is how a page ends up with the same headline twice.
 */
export function fillSection<T extends { id: string }>(
  own: readonly T[],
  pool: readonly T[],
  size: number,
  used: Set<string>,
): T[] {
  const row: T[] = [];

  for (const item of [...own, ...pool]) {
    if (row.length >= size) break;
    if (used.has(item.id)) continue;
    row.push(item);
    used.add(item.id);
  }

  return row;
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