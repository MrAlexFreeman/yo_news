import "server-only";

import {
  FEED_SOURCES,
  type FeedSource,
  type ParsedFeedItem,
  isPoliticalText,
  parseDzenFeed,
  parseFeed,
} from "@/lib/feed-parse";
import { prisma } from "@/lib/prisma";
import { fetchWireText } from "@/lib/wire-fetch";

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

/**
 * A body larger than this is not a feed. Feeds are tens of kilobytes; the cap exists so
 * a wrong URL that returns a video, or an outlet that starts paginating without bound,
 * cannot be read into memory and parsed.
 */
const MAX_FEED_BYTES = 4 * 1024 * 1024;

/** The `Accept` header a feed poll sends. The user agent and the guards live in wire-fetch.ts. */
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

/**
 * Выдача Дзена — JSON, и просить её надо как JSON.
 *
 * Браузерного User-Agent играть не нужно: проверено, что наш `EartnewsBot/1.0` получает ту же
 * выдачу, что Chrome. А вот `Accept` важен — это единственное, чем один адрес отличается от
 * другого запроса к тому же API, и без него ответ приходит «Unknown api request».
 */
const DZEN_ACCEPT = "application/json, text/plain, */*";

export type SourceSyncResult = {
  source: FeedSource;
  title: string;
  /** Rows actually written. Items already known are not counted. */
  inserted: number;
  /** Elements the feed carried that could not be used. */
  skipped: number;
  /**
   * Из отказавшихся — те, что отсеяны как политика.
   *
   * Отдельным числом, потому что это не сбой и не мусор в ленте, а работа фильтра: редактору
   * важно видеть, что отбор идёт («политика: 4»), иначе он решит, что лента обеднела сама.
   */
  political: number;
  /** Set when the source could not be read at all. */
  error?: string;
};

export type SyncSummary = {
  at: string;
  sources: SourceSyncResult[];
  inserted: number;
  /** Сколько ранее сохранённых материалов скрыто новым правилом о политике. */
  hidden: number;
};

/**
 * Скрывает из предложки то, что по нынешним правилам в неё не прошло бы.
 *
 * Материал, записанный до того, как правило появилось или стало строже, остаётся в списке
 * навсегда: он уже в базе, а фильтры работают только на входе. Проверка на проде это и
 * показала — «У Екатеринбурга появился новый глава» продолжало стоять в предложке после того,
 * как лента перестала его пропускать, а десять карточек Дзена вошли туда до появления окна
 * свежести.
 *
 * Правил два, и оба те же, что на входе: политика и срок годности источника. Отмеченные
 * `IGNORED`, а не удалённые: скрытое лежит во вкладке «Скрытые», и если слово из списка или
 * само окно окажется лишним, редакция вернёт материал кнопкой, а не будет ждать, пока он
 * придёт из ленты заново.
 */
async function hideStoredByRules(): Promise<number> {
  const stored = await prisma.newsFeedItem.findMany({
    where: { status: "NEW" },
    select: { id: true, title: true, rawText: true, source: true, publishedAt: true },
  });

  const now = Date.now();
  const stale = (source: string, publishedAt: Date): boolean => {
    const feed = FEED_SOURCES.find((entry) => entry.source === source);
    if (feed?.maxAgeDays === undefined) return false;
    return publishedAt.getTime() < now - feed.maxAgeDays * 24 * 60 * 60 * 1000;
  };

  const drop = stored.filter(
    (item) => isPoliticalText(item.title, item.rawText) || stale(item.source, item.publishedAt),
  );
  if (drop.length === 0) return 0;

  await prisma.newsFeedItem.updateMany({
    where: { id: { in: drop.map((item) => item.id) } },
    data: { status: "IGNORED" },
  });

  return drop.length;
}

/**
 * Fetches and stores every configured feed.
 *
 * Never throws. Returns a per-source summary so the button can say what happened —
 * "добавлено 12, Топ Е1 недоступен" is the answer an editor needs, and a bare success
 * toast after a silent failure is the one outcome that would waste their morning.
 *
 * Резервные ленты идут вторым проходом и только тогда, когда их основной источник не дал
 * ничего: пара «Топ Дзен — Топ Урал» задумана как подстраховка, а не как два одинаковых
 * потока в списке. Молчание резерва в сводку не попадает — «Топ Урал: +0» рядом с работающим
 * Дзеном читалось бы как поломка.
 */
export async function syncFeeds(): Promise<SyncSummary> {
  const sources: SourceSyncResult[] = [];

  /** Сколько годных карточек дал каждый источник в этом прогоне. */
  const accepted = new Map<FeedSource, number>();

  for (const feed of FEED_SOURCES.filter((entry) => !entry.fallbackFor)) {
    const result = await syncOne(feed);
    accepted.set(feed.source, result.accepted);
    sources.push(result.summary);
  }

  for (const feed of FEED_SOURCES.filter((entry) => entry.fallbackFor)) {
    if ((accepted.get(feed.fallbackFor as FeedSource) ?? 0) > 0) continue;

    console.log(
      `[feed] резерв: ${feed.title} — основной источник дал 0 материалов, берём резервную ленту`,
    );
    const result = await syncOne(feed);
    accepted.set(feed.source, result.accepted);
    sources.push(result.summary);
  }

  const hidden = await hideStoredByRules();
  if (hidden > 0) {
    console.log(`[feed] правила: скрыто ранее сохранённых материалов — ${hidden}`);
  }

  return {
    at: new Date().toISOString(),
    sources,
    inserted: sources.reduce((total, source) => total + source.inserted, 0),
    hidden,
  };
}

/**
 * Одна лента: забрать, разобрать, записать.
 *
 * Читается либо как RSS, либо как карточки Дзена — по `kind` источника. Разница только в
 * разборе: дальше всё общее, включая фильтр политики, который живёт внутри обоих разборов, и
 * запись с дедупликацией по `externalId`.
 */
async function syncOne(
  feed: (typeof FEED_SOURCES)[number],
): Promise<{ summary: SourceSyncResult; accepted: number }> {
  const isDzen = feed.kind === "dzen";

  try {
    const body = await fetchWireText(feed.url, {
      accept: isDzen ? DZEN_ACCEPT : FEED_ACCEPT,
      maxBytes: MAX_FEED_BYTES,
    });
    const parsed = isDzen
      ? parseDzenFeed(body, { source: feed.source, maxAgeDays: feed.maxAgeDays })
      : parseFeed(body, { source: feed.source, assumeUndated: feed.undated });

    const written = await storeItems(parsed.items);

    return {
      accepted: parsed.items.length,
      summary: {
        source: feed.source,
        title: feed.title,
        inserted: written,
        skipped: parsed.skipped.length,
        political: parsed.skipped.filter((item) => item.reason === "politics").length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    console.warn(`[feed] ${feed.source} не прочитан: ${message}`);
    return {
      accepted: 0,
      summary: {
        source: feed.source,
        title: feed.title,
        inserted: 0,
        skipped: 0,
        political: 0,
        error: message,
      },
    };
  }
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

