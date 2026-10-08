import "server-only";

/**
 * One guarded request to another newsroom's server.
 *
 * Shared by the two places the desk reaches out: the RSS poll (`feed-sync.ts`) and the
 * full-text fetch behind «Создать материал» (`feed-fulltext.ts`). They want the same
 * three things — a UA that names us, a timeout, and a ceiling on how much is read into
 * memory — and two copies of those would drift.
 *
 * Server-only because it reaches the network.
 */

/**
 * Named, and with a contact URL, because the alternative is being blocked. Outlets
 * rate-limit or refuse anonymous scrapers, and a request that identifies itself as this
 * publication is what a support email can point at.
 *
 * ASCII only, and that is not cosmetic: HTTP header values are ByteStrings, and a
 * non-latin character anywhere in this string makes `fetch` throw
 * "Cannot convert argument to a ByteString" before the request is sent. The first
 * version of this constant carried a Russian tail and every sync failed with that —
 * an error that names neither the feed nor the header it came from. `check-feed.mts`
 * asserts the character range, because the failure is invisible until the moment it
 * matters.
 *
 * Measured 2026-10-08: both outlets answer this UA with the full feed and the full
 * article page — the same bytes and the same extracted body as a Chrome UA sent to the
 * same URLs. There is nothing a browser string would add here, so the honest one stays.
 */
export const USER_AGENT = "EartnewsBot/1.0 (+https://eartnews.ru; editorial-wire)";

/** How long one request may take before it is abandoned. */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * A body larger than this is not something the desk asked for.
 *
 * The cap exists so a wrong URL that returns a video, or an outlet that starts
 * paginating without bound, cannot be read into memory and parsed.
 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export type WireFetchOptions = {
  /** The `Accept` header. The one thing the two callers do not share. */
  accept: string;
  maxBytes?: number;
  timeoutMs?: number;
};

/**
 * Reads a third-party URL as text, or throws with a reason.
 *
 * Never cached: a cached response would mean a sync that reports success and adds
 * nothing, and a full-text fetch that silently returns yesterday's page.
 */
export async function fetchWireText(url: string, options: WireFetchOptions): Promise<string> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: options.accept },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // `content-length` is advisory — a server may lie or omit it — so the body is checked
  // again after it is read. The header check only avoids downloading the obvious case.
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error("ответ больше допустимого размера");
  }

  const body = await response.text();
  if (body.length > maxBytes) {
    throw new Error("ответ больше допустимого размера");
  }

  return body;
}
