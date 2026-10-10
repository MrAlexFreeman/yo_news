/**
 * The Unsplash photo search, and the credit an Unsplash photo carries.
 *
 * Pure — no Prisma, no `server-only`, no credentials — so the security suite can assert
 * what may be fetched and what a credit looks like without standing up the queue.
 *
 * **The rate limit is the design constraint.** Measured against the key in the settings:
 * `x-ratelimit-limit: 50` per hour for *all* API calls, search and photo lookup alike, and
 * the counter is shared between them. A picker that searched on every keystroke would
 * spend fifty searches on one article and then fail for the rest of the hour with a 403
 * an editor cannot explain. Everything here is therefore built around "as few calls as
 * the choice actually needs": three results, no search-as-you-type, and a server-side
 * cache so reopening the dialog does not re-ask the same question.
 */

/** The search endpoint, fixed. Nothing here may choose a host. */
export const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";

/** One photo's metadata, for the download step. */
export const UNSPLASH_PHOTO_URL = "https://api.unsplash.com/photos";

/** Where the bytes actually live. The only host an image may be fetched from. */
export const UNSPLASH_IMAGE_HOSTS = ["images.unsplash.com"] as const;

/**
 * Results per page. Twelve, and the grid shows all twelve at once.
 *
 * Changed from three when the picker grew a grid: three cards and a "show more" button cost
 * a click per three photographs, and each page is one of fifty hourly calls. Twelve fills
 * a three-column grid in four rows and covers most of what an editor wants from one word
 * before they start clicking through.
 */
export const UNSPLASH_PER_PAGE = 12;

/** How many pages the editor may page through in one sitting. */
export const UNSPLASH_MAX_PAGES = 10;

/**
 * What a search costs against the hourly budget.
 *
 * Measured, not invented: a search request spends one of the fifty, and so does the
 * metadata lookup a download performs. The number is here so the UI can say "осталось 12"
 * and stop asking, rather than discovering the ceiling as a bare 403.
 */
export const UNSPLASH_HOURLY_LIMIT = 50;

/** One wall-clock budget per API call. Cold Unsplash is fast; the ceiling is a backstop. */
export const UNSPLASH_TIMEOUT_MS = 20_000;

/**
 * The image width the cover gets.
 *
 * `urls.regular` is already 1080px wide — measured on a real answer — which is the width
 * the site's own generated covers use, and is what keeps a stock photo inside the 8 MB
 * upload cap. `urls.full` is the original resolution, often 4000px, which sharp would then
 * have to downscale: larger to download, larger to decode, and no gain in print.
 */
export const UNSPLASH_COVER_WIDTH = 1080;

/** Longest search term, so a pasted paragraph cannot become a request line. */
export const UNSPLASH_QUERY_LIMIT = 120;

/**
 * The search URL for one page.
 *
 * `orientation=landscape` and a fixed `per_page`. The orientation is also the only reason
 * the results are worth showing: a portrait photo on a 16:9 cover is cropped by the layout
 * rather than chosen by the editor.
 */
export function buildSearchUrl(query: string, page = 1): string {
  // Page 1 is left off: Unsplash treats `page=1` as identical and there is no reason to
  // put a redundant parameter in a URL the route caches by.
  const term = query.trim().slice(0, UNSPLASH_QUERY_LIMIT);

  const url = new URL(UNSPLASH_SEARCH_URL);
  url.searchParams.set("query", term);
  url.searchParams.set("per_page", String(UNSPLASH_PER_PAGE));
  url.searchParams.set("orientation", "landscape");
  // Page 1 is the default and is left off, because Unsplash treats `page=1` as identical
  // and there is no reason to put a redundant parameter in a cached URL.
  if (page > 1) url.searchParams.set("page", String(page));

  return url.toString();
}

/** The metadata URL for one photo id. */
export function photoUrl(id: string): string {
  return `${UNSPLASH_PHOTO_URL}/${encodeURIComponent(id)}`;
}

/**
 * Russian words that carry no visual meaning.
 *
 * Exported because `lib/stock-query.ts` needs the same list for its transliteration
 * fallback, and the two must agree: one seeds the search box and the other decides what to
 * send when the model is unavailable. Different lists would show the editor one set of words
 * in the field and search another — which is the kind of thing nobody notices until a
 * translated title finds nothing and nobody can say why.
 *
 * Deliberately short and grammatical. «новый» and «год» are not here: a newsroom asks for
 * the new park, and the year may be the only specific thing in the headline.
 */
export const TITLE_STOP_WORDS = new Set([
  "в", "на", "по", "и", "не", "что", "с", "к", "из", "у", "о", "об", "для", "а", "но",
  "как", "мы", "вы", "они", "он", "она", "это", "его", "её", "их", "их",
  "открыл", "открыли", "стал", "стала", "стали", "начал", "начали", "сообщил",
  "сообщили", "рассказал", "рассказали", "заявил", "заявили", "стало", "стали",
]);

/**
 * The keyword an editor would have typed, taken from an article's own title.
 *
 * Cut to a few words on purpose: Unsplash matches on the whole query string, and a title
 * of «В Екатеринбурге начали строить новый экологический парк» returns almost nothing
 * where «экологический парк екатеринбург» returns photographs. Stop words go first, and
 * the rest are capped — the editor can retype whatever they meant.
 */
export function keywordsFromTitle(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOP_WORDS.has(word))
    .slice(0, 5);

  return words.join(" ").slice(0, UNSPLASH_QUERY_LIMIT);
}

/** One photograph, reduced to what the editor is shown. */
export type StockPhoto = {
  id: string;
  /** A sentence for `alt`, written by the photographer where they wrote one. */
  description: string;
  /** 1080px-wide preview for the grid. */
  previewUrl: string;
  width: number;
  height: number;
  authorName: string;
  authorUrl: string;
  /** The photo's page on unsplash.com — the second link the licence requires. */
  photoUrl: string;
  /**
   * Where the download must be announced.
   *
   * Kept, and never used as a URL to fetch: the download route re-reads the photo's
   * metadata from Unsplash by id and takes this from *that* answer, so a hand-written
   * body cannot point the ping somewhere else.
   */
  downloadLocation: string;
};

/**
 * Reads a search answer into photos, or says why it is not one.
 *
 * Every field is checked rather than cast. The response comes from a third party whose
 * shape can change, and each of these values ends up either in an `<img src>` or in the
 * public credit — a photo whose `previewUrl` is missing must not become a card with a
 * broken image and an author nobody can be credited to.
 */
export function readSearchResponse(payload: unknown): StockPhoto[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;

  if (Array.isArray(body.errors)) return [];

  const results = body.results;
  if (!Array.isArray(results)) return [];

  const photos: StockPhoto[] = [];

  for (const entry of results) {
    const photo = readPhoto(entry);
    if (photo) photos.push(photo);
    if (photos.length >= UNSPLASH_PER_PAGE) break;
  }

  return photos;
}

/** One photo out of the answer, or null when it is not usable. */
function readPhoto(entry: unknown): StockPhoto | null {
  if (!entry || typeof entry !== "object") return null;
  const photo = entry as Record<string, unknown>;

  const id = typeof photo.id === "string" ? photo.id.trim() : "";
  if (!id) return null;

  const urls = photo.urls as Record<string, unknown> | undefined;
  const previewUrl = typeof urls?.regular === "string" ? urls.regular : "";
  // Only https on Unsplash's own CDN. This URL is written into an `<img src>` and, from
  // the download route, into a server-side fetch — a hand-written answer naming another
  // host would be a tracker in the grid and an SSRF in the download.
  if (!previewUrl.startsWith("https://images.unsplash.com/")) return null;

  const links = photo.links as Record<string, unknown> | undefined;
  const user = photo.user as Record<string, unknown> | undefined;
  const userLinks = user?.links as Record<string, unknown> | undefined;

  const authorName = typeof user?.name === "string" ? user.name.trim() : "";
  const authorUrl = typeof userLinks?.html === "string" ? userLinks.html : "";
  const pageUrl = typeof links?.html === "string" ? links.html : "";
  const downloadLocation =
    typeof links?.download_location === "string" ? links.download_location : "";

  // The credit is mandatory under the licence, so a photo whose author cannot be named
  // is not offered rather than offered unattributed.
  if (!authorName || !authorUrl.startsWith("https://unsplash.com/")) return null;

  const description =
    (typeof photo.alt_description === "string" && photo.alt_description.trim()) ||
    (typeof photo.description === "string" && photo.description.trim()) ||
    "";

  return {
    id,
    description: description.slice(0, 200),
    previewUrl,
    width: toPositiveInt(photo.width),
    height: toPositiveInt(photo.height),
    authorName: authorName.slice(0, 80),
    authorUrl,
    photoUrl: pageUrl.startsWith("https://unsplash.com/") ? pageUrl : `https://unsplash.com/photos/${encodeURIComponent(id)}`,
    downloadLocation,
  };
}

function toPositiveInt(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** How many results Unsplash says it holds, for the "показать ещё" decision. */
export function readTotal(payload: unknown): number {
  const total = Number((payload as { total?: unknown } | null)?.total);
  return Number.isFinite(total) && total > 0 ? Math.min(total, UNSPLASH_MAX_PAGES * UNSPLASH_PER_PAGE) : 0;
}

/**
 * The remaining hourly budget, from the response headers.
 *
 * Null when Unsplash did not say — which is the case to be careful about: an unknown
 * remaining count must read as "no more pages" rather than as "plenty left", because the
 * alternative is a button that keeps spending until a 403.
 */
export function readRateLimitRemaining(headers: Headers | undefined): number | null {
  const raw = headers?.get("x-ratelimit-remaining");
  if (raw === null || raw === undefined) return null;

  const remaining = Number(raw);
  return Number.isFinite(remaining) ? Math.max(0, Math.round(remaining)) : null;
}

/**
 * The credit line, as the editor sees it in the form.
 *
 * Plain text, because `photoSource` is rendered as a text node on the public page and
 * travels into the RSS feed as text. The links the licence requires cannot live here —
 * that is what the two dedicated article columns are for, and this string is what the
 * datalist and the feed print.
 */
export function formatStockCredit(photo: Pick<StockPhoto, "authorName">): string {
  return `Фото: ${photo.authorName} / Unsplash`;
}

/**
 * The credit's two links, for the public caption.
 *
 * Unsplash's attribution rules ask for the photographer's name to link to their profile
 * and for the word Unsplash to link to the photo's page. Both URLs are re-checked here,
 * not carried over from the search: they are written into `href` attributes on a public
 * page, and a stored value that is not an Unsplash https URL must not become a link.
 */
export function stockCreditLinks(photo: {
  authorName?: unknown;
  authorUrl?: unknown;
  photoUrl?: unknown;
}): { authorName: string; authorUrl: string; photoUrl: string } | null {
  const authorName = typeof photo.authorName === "string" ? photo.authorName.trim().slice(0, 80) : "";
  const authorUrl = typeof photo.authorUrl === "string" ? photo.authorUrl.trim() : "";
  const photoUrl = typeof photo.photoUrl === "string" ? photo.photoUrl.trim() : "";

  if (!authorName) return null;
  if (!isUnsplashPage(authorUrl)) return null;
  if (!isUnsplashPage(photoUrl)) return null;

  return { authorName, authorUrl, photoUrl };
}

/** An absolute https address on unsplash.com, and nothing else. */
export function isUnsplashPage(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "unsplash.com" &&
    !parsed.username &&
    !parsed.password
  );
}

/**
 * Whether an image URL may be fetched by the server.
 *
 * The host allowlist, and the reason it exists: this value arrives from a third-party
 * answer and is used to write bytes into `UPLOAD_DIR`. Widening it to "any https URL"
 * would turn the download route into an SSRF fetcher pointed at the newsroom's editor.
 */
export function isFetchableUnsplashImage(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;

  return (UNSPLASH_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname);
}

/** The slice of `fetch` this project uses, matching the shape in lib/hf-upscale.ts. */
export type FetchLike = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export type UnsplashSearchResult = {
  photos: StockPhoto[];
  total: number;
  remaining: number | null;
};

/**
 * One search, through an injected `fetch`.
 *
 * Split from the route for the reason `lib/fal-queue.ts` is split from its route: the
 * interesting behaviour is a 401 the provider returns and a 403 when the hourly budget
 * runs out, and neither can be arranged against the real service without spending an
 * editor's fifty.
 */
export async function searchUnsplash(
  fetchImpl: FetchLike,
  accessKey: string,
  query: string,
  page = 1,
): Promise<UnsplashSearchResult> {
  const response = await fetchImpl(buildSearchUrl(query, page), {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      // Pinned so a change on Unsplash's side cannot silently move this project onto a
      // different contract the day after it was written.
      "Accept-Version": "v1",
    },
    signal: AbortSignal.timeout(UNSPLASH_TIMEOUT_MS),
  });

  const remaining = readRateLimitRemaining(response.headers);

  if (response.status === 403) {
    /*
      Unsplash answers 403 for an exhausted hourly budget, not only for a bad key — the
      two mean very different things to an editor, and both arrive here as a 403 with a
      message saying which. Passed through rather than swallowed: the UI has to be able to
      say "лимит часа исчерпан" instead of "попробуйте позже".
    */
    throw new UnsplashError("hourly limit reached", "hourly limit reached");
  }
  if (response.status === 401) {
    throw new UnsplashError("Unsplash отклонил ключ доступа", "auth");
  }

  if (!response.ok) {
    throw new UnsplashError(`Unsplash ответил ${response.status}`, "unknown");
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  return {
    photos: readSearchResponse(payload),
    total: readTotal(payload),
    remaining,
  };
}

/** What went wrong, and what the editor should do about it. */
export type UnsplashFailure = "auth" | "hourly limit reached" | "unknown";

export class UnsplashError extends Error {
  constructor(
    message: string,
    readonly kind: UnsplashFailure,
  ) {
    super(message);
    this.name = "UnsplashError";
  }
}

/** One photo's metadata, read back by id for the download. */
export async function readUnsplashPhoto(
  fetchImpl: FetchLike,
  accessKey: string,
  id: string,
): Promise<StockPhoto | null> {
  const response = await fetchImpl(photoUrl(id), {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
    signal: AbortSignal.timeout(UNSPLASH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new UnsplashError(
      response.status === 403 ? "hourly limit reached" : `Unsplash ответил ${response.status}`,
      response.status === 403 ? "hourly limit reached" : "unknown",
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const photos = readSearchResponse({ results: payload ? [payload] : [] });
  return photos[0] ?? null;
}