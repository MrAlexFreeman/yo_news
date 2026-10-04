/**
 * Gallery items attached to an article.
 *
 * Stored in `Article.media` as a JSON array. A separate join table was the other
 * option, but an image row has no fields worth querying on — it is only ever read
 * as an ordered list belonging to one article — and SQLite pays for every extra
 * table on a 709 MB VPS.
 *
 * Dimensions are recorded at upload time because the RSS feed has to drop images
 * below Dzen's minimum. Reading them back would mean parsing a JPEG or PNG header
 * on every feed build, which is a lot of machinery for a number we already had
 * in the browser when the file was picked.
 */

export type MediaItem = {
  /** Site-relative (/uploads/x.jpg) or absolute. */
  url: string;
  caption: string;
  /** Credit line, printed after the caption. */
  source: string;
  /** Intrinsic pixels, or 0 when unknown (a pasted URL rather than an upload). */
  width: number;
  height: number;
};

/** Dzen drops an image below this and publishes the piece without any picture. */
export const DZEN_MIN_WIDTH = 480;
export const DZEN_MIN_HEIGHT = 320;

/** Upper bound on a gallery, matching Dzen's own "up to 10 pictures" post rule. */
export const MAX_MEDIA_ITEMS = 10;

/**
 * Anything not one of these is dropped rather than shipped: Dzen's own words are
 * that an image in the wrong format means "the material will be published without
 * the picture", taking the whole publication down with it.
 */
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif"];

export function hasAllowedExtension(url: string): boolean {
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  return ALLOWED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * True when the image is plausibly displayable by Dzen.
 *
 * Dimensions are only checked when they are known: an item pasted as a bare URL
 * carries none, and refusing it would block the editor from using their own
 * hosted image, which is a legitimate thing to want.
 */
export function meetsDzenMinimum(item: MediaItem): boolean {
  if (!hasAllowedExtension(item.url)) return false;
  if (item.width === 0 || item.height === 0) return true;
  return item.width >= DZEN_MIN_WIDTH && item.height >= DZEN_MIN_HEIGHT;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asDimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/**
 * Reads whatever is in the column into a clean list.
 *
 * Defensive on purpose: this is a JSON column, and a row written by an older
 * build, a hand-edited script or a bad import can hold anything. A malformed entry
 * is dropped rather than allowed to break the page.
 */
export function parseMedia(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const items: MediaItem[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;

    const url = asString(raw.url).trim();
    if (!url || seen.has(url)) continue;

    seen.add(url);
    items.push({
      url,
      caption: asString(raw.caption).trim().slice(0, 300),
      source: asString(raw.source).trim().slice(0, 200),
      width: asDimension(raw.width),
      height: asDimension(raw.height),
    });

    if (items.length >= MAX_MEDIA_ITEMS) break;
  }

  return items;
}

/** Parses the JSON the hidden form field carries. Never throws. */
export function parseMediaField(raw: string | null | undefined): MediaItem[] {
  if (!raw || raw.trim() === "") return [];
  try {
    return parseMedia(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeMedia(items: MediaItem[]): string {
  return JSON.stringify(items.map((item) => ({ ...item })));
}