import "server-only";

import { FEED_SOURCES, type FeedSource, type ParsedFeedItem, parseFeed } from "@/lib/feed-parse";
import { prisma } from "@/lib/prisma";

/**
 * Pulling the wire feeds into the desk.
 *
 * Server-only: it writes rows and reaches the network. The parsing is all in
 * feed-parse.ts, which is pure and where the tests are.
 *
 * One outlet failing must not lose the other's stories, so every source is fetched and
 * written on its own and its failure is reported rather than thrown. A desk that shows
 * "URA недоступен" and yesterday's E1 items is more useful than one that shows an error
 * page after a successful fetch of half the work.
 */

const FETCH_TIMEOUT_MS = 20_000;

/**
 * A body larger than this is not a feed. Feeds are tens of kilobytes; the cap exists so
 * a wrong URL that returns a video, or an outlet that starts paginating without bound,
 * cannot be read into memory and parsed.
 */
const MAX_FEED_BYTES = 4 * 1024 * 1024;

/**
 * Named, and with a contact URL, because the alternative is being blocked. Outlets
 * rate-limit or refuse anonymous scrapers, and a request that identifies itself as this
 * publication is what a support email can point at.
 *
 * ASCII only, and that is not cosmetic: HTTP header values are ByteStrings, and a
 * non-latin character anywhere in this string makes `fetch` throw
 * "Cannot convert argument to a ByteString" before the request is sent. The first
 * version of this constant carried a Russian tail and every sync failed with that —
 * an error that names neither the feed nor the header it came from. The suite now
 * asserts the character range, because the failure is invisible until the moment it
 * matters.
 *
 * Measured: both outlets answer this UA with 200 and the full feed.
 */
const USER_AGENT = "EartnewsBot/1.0 (+https://eartnews.ru; editorial-wire)";

export type SourceSyncResult = {
  source: FeedSource;
  title: string;
  /** Rows actually written. Items already known are not counted. */
  inserted: number;
  /** Elements the feed carried that could not be used. */
  skipped: number;
  /** Set when the source could not be read at all. */
  error?: string;
};

export type SyncSummary = {
  at: string;
  sources: SourceSyncResult[];
  inserted: number;
};

/**
 * Fetches and stores every configured feed.
 *
 * Never throws. Returns a per-source summary so the button can say what happened —
 * "добавлено 12, URA недоступен" is the answer an editor needs, and a bare success
 * toast after a silent failure is the one outcome that would waste their morning.
 */
export async function syncFeeds(): Promise<SyncSummary> {
  const sources: SourceSyncResult[] = [];

  for (const feed of FEED_SOURCES) {
    try {
      const xml = await fetchFeed(feed.url);
      const parsed = parseFeed(xml, { source: feed.source });

      const written = await storeItems(parsed.items);

      sources.push({
        source: feed.source,
        title: feed.title,
        inserted: written,
        skipped: parsed.skipped.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      console.warn(`[feed] ${feed.source} не прочитан: ${message}`);
      sources.push({
        source: feed.source,
        title: feed.title,
        inserted: 0,
        skipped: 0,
        error: message,
      });
    }
  }

  return {
    at: new Date().toISOString(),
    sources,
    inserted: sources.reduce((total, source) => total + source.inserted, 0),
  };
}

/**
 * Writes the fresh items, counting only the ones that were actually new.
 *
 * Two steps, and neither alone is enough:
 *
 *  - A read of the identifiers already stored, so the usual case — a feed that has not
 *    changed since the last sync — costs one query and no writes.
 *  - A per-item insert that treats a unique clash as "already there". The read and the
 *    write are not one atomic step, and the cron can fire while somebody is pressing
 *    the button; without this the second writer would lose its whole batch, or worse,
 *    the batch would abort and the desk would silently miss the items it had not yet
 *    seen. Prisma's `createMany({ skipDuplicates })` would be the tidy answer, and
 *    SQLite is exactly the provider that does not implement it.
 */
async function storeItems(items: ParsedFeedItem[]): Promise<number> {
  if (items.length === 0) return 0;

  const ids = items.map((item) => item.externalId);
  const known = new Set(
    (
      await prisma.newsFeedItem.findMany({
        where: { externalId: { in: ids } },
        select: { externalId: true },
      })
    ).map((row) => row.externalId),
  );

  let inserted = 0;

  for (const item of items) {
    if (known.has(item.externalId)) continue;

    try {
      await prisma.newsFeedItem.create({
        data: {
          source: item.source,
          externalId: item.externalId,
          originalUrl: item.originalUrl,
          title: item.title,
          rawText: item.rawText,
          publishedAt: item.publishedAt,
        },
      });
      inserted += 1;
    } catch (error) {
      // P2002 is the unique-constraint violation: another writer got there first, which
      // is the desired outcome rather than a failure.
      if (!isUniqueViolation(error)) throw error;
      known.add(item.externalId);
    }
  }

  return inserted;
}

/** Prisma's code for "unique constraint failed". */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** One feed body, with the guards a third-party URL needs. */async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    // A cached response would mean a sync that reports success and adds nothing.
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
    throw new Error("лента больше допустимого размера");
  }

  const body = await response.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new Error("лента больше допустимого размера");
  }

  return body;
}
