import { NextResponse } from "next/server";

import { getSetting } from "@/lib/settings";
import {
  searchUnsplash,
  UNSPLASH_HOURLY_LIMIT,
  UNSPLASH_PER_PAGE,
  UnsplashError,
} from "@/lib/unsplash";

export const runtime = "nodejs";
/** Reads a key and spends an Unsplash call; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/articles/stock-search` — photographs from Unsplash.
 *
 * Under `/api/admin/`, so Basic Auth applies. The key stays on the server: a Client-ID in
 * a browser response is a key in a browser, and this one is what the download route uses
 * to sign its own calls.
 *
 * **Why the cache is here at all.** Unsplash allows 50 API calls an hour, shared between
 * search and photo lookup, and the counter is the API's — not this route's. An editor who
 * opens the dialog, searches, closes it and opens it again must not spend four of those
 * fifty on the same question, and the editor who pages through results must be able to
 * see what is left before they run out rather than after. Both are why `remaining` is
 * passed through to the browser and why identical searches are answered from memory.
 */

type CacheEntry = { at: number; body: unknown; remaining: number | null };

/**
 * How long an answer is reused.
 *
 * Unsplash's result for a word does not change in a minute, and the window is shorter than
 * an editor's thinking: it exists to collapse a reopened dialog, not to answer a different
 * question later.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Ten entries, keyed by term and page.
 *
 * Bounded on purpose. An unbounded map here is a memory leak dressed as a feature, and the
 * only thing it would ever be asked to remember is what a single editor looked at in the
 * last minute.
 */
const CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 10;

function cacheGet(key: string): CacheEntry | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit;
}

function cachePut(key: string, entry: CacheEntry): void {
  // Re-inserted so the oldest key is the first evicted; a plain `set` on an existing key
  // would leave insertion order alone and the bound would stop meaning "the oldest".
  CACHE.delete(key);
  CACHE.set(key, entry);
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
}

/** What the editor is told when Unsplash refuses. */
function failure(kind: string) {
  if (kind === "auth") {
    return { status: 502, error: "Unsplash отклонил ключ доступа. Проверьте его в /admin/settings." };
  }
  if (kind === "hourly limit reached") {
    return {
      status: 429,
      error:
        "Часовая лимита Unsplash исчерпан (50 запросов в час). Попробуйте позже или возьмите фото из другого источника.",
    };
  }
  return { status: 502, error: "Unsplash недоступен. Попробуйте позже." };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const page = Math.max(1, Math.min(Number(params.get("page")) || 1, 10));

  if (!query) {
    return NextResponse.json(
      { error: "Введите запрос: пустой поиск вернул бы пять тысяч случайных снимков." },
      { status: 400 },
    );
  }

  const cacheKey = `${query.toLowerCase()}|${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached.body, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const accessKey = (await getSetting("UNSPLASH_ACCESS_KEY")).trim();
  if (!accessKey) {
    return NextResponse.json(
      {
        error:
          "Не задан ключ Unsplash — добавьте его в /admin/settings, чтобы подбирать фото на стоках.",
      },
      { status: 503 },
    );
  }

  let result;
  try {
    result = await searchUnsplash(fetch as never, accessKey, query, page);
  } catch (error) {
    if (error instanceof UnsplashError) {
      return NextResponse.json(failure(error.kind), { status: failure(error.kind).status });
    }
    return NextResponse.json(
      { error: "Unsplash недоступен. Попробуйте позже." },
      { status: 502 },
    );
  }

  const body = {
    photos: result.photos,
    total: result.total,
    remaining: result.remaining,
    // Sent alongside the count so the UI can say what is left in words rather than
    // making the editor remember the number.
    limit: UNSPLASH_HOURLY_LIMIT,
    perPage: UNSPLASH_PER_PAGE,
  };

  cachePut(cacheKey, { at: Date.now(), body, remaining: result.remaining });

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}