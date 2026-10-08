import "server-only";

import { extractArticleText, looksTruncated, preferExtracted } from "@/lib/article-extract";
import { prisma } from "@/lib/prisma";
import { fetchWireText } from "@/lib/wire-fetch";

/**
 * From a teaser to the story behind it.
 *
 * The feeds cut their text: measured, URA's `<description>` is 97 characters ending in
 * "Читать далее", and E1's is a sentence. A rewriter given that has no facts to work
 * with, and neither has an editor. So when a wire item is opened, the page its teaser
 * points at is fetched and read, and the story is written back over the teaser.
 *
 * Where this runs and where it deliberately does not:
 *
 *  - On «Создать материал» — one page per story the desk actually wants. The button is a
 *    Server Action, so this runs on a POST, not while a page renders: the Next guide on
 *    data security is explicit that "updating databases ... should never be a side-effect"
 *    of rendering, and a GET that writes is also a GET a link prefetch could fire. The
 *    result is stored, so the second open is instant and the rewriter, which re-reads the
 *    row, gets the full text too.
 *  - Not during the background sync. A sync turns over every few minutes and would fetch
 *    every headline the two outlets publish, most of which nobody will open. That is a
 *    lot of traffic aimed at somebody else's server for stories that are never used.
 *
 * Server-only: it reads the network and writes rows.
 */

/**
 * A page is bigger than a feed — E1's article is around 550 KB of markup — so the cap is
 * higher than the feed one. It is here rather than behind a cast because an outlet that
 * suddenly serves an unbounded document must not be read into memory.
 */
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/** A page that takes longer than this is not worth a slow «Создать материал». */
const PAGE_TIMEOUT_MS = 25_000;

/** What a page fetch asks for. */
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** The fields the enrichment needs from a wire item. */
export type FullTextItem = {
  id: string;
  title: string;
  rawText: string;
  originalUrl: string;
};

export type FullTextOutcome = {
  /** The text to work from: the fetched story, or the teaser when there is nothing better. */
  text: string;
  /** True when the stored row was rewritten with the full text. */
  enriched: boolean;
  /** Which path produced `text`. `cached` means the stored text was already a story. */
  method: "cached" | "selector" | "readability" | "none";
  /** Set when the page could not be read; the teaser is what remains. */
  error?: string;
};

/**
 * Loads an item and upgrades its stored text.
 *
 * Exists so the action stays policy-free: the action decides *when* to call this (on
 * «Создать материал»), this decides *what* happens. Returns false for an unknown id, so
 * a stale page does not crash the navigation.
 */
export async function enrichStoredItem(id: string): Promise<boolean> {
  const item = await prisma.newsFeedItem.findUnique({
    where: { id },
    select: { id: true, title: true, rawText: true, originalUrl: true },
  });

  if (!item) return false;

  await ensureFullText(item);
  return true;
}

/**
 * The item's full text, fetching and storing it when all it has is a teaser.
 *
 * Never throws: it is called while a page is rendering, and a third party being down is
 * not a reason for «Создать материал» to be an error page. The failure is logged and the
 * teaser is returned, which is exactly what the editor would have had before.
 */
export async function ensureFullText(item: FullTextItem): Promise<FullTextOutcome> {
  if (!looksTruncated(item.rawText)) {
    return { text: item.rawText, enriched: false, method: "cached" };
  }

  let html: string;
  try {
    html = await fetchWireText(item.originalUrl, {
      accept: PAGE_ACCEPT,
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: PAGE_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    console.warn(`[feed] полный текст ${item.originalUrl} не получен: ${message}`);
    return { text: item.rawText, enriched: false, method: "none", error: message };
  }

  const extracted = extractArticleText(html, { title: item.title, url: item.originalUrl });

  if (!preferExtracted(item.rawText, extracted.text)) {
    // The page was read but held no more than the teaser — a paywall stub, a redirect to
    // a section, or an outlet that renders the body client-side. Keeping the teaser is
    // the honest outcome; inventing text is not an option.
    return { text: item.rawText, enriched: false, method: extracted.method };
  }

  try {
    await prisma.newsFeedItem.update({
      where: { id: item.id },
      data: { rawText: extracted.text },
    });
  } catch (error) {
    // A failed write is not a failed read. The editor still gets the full text for this
    // session; only the caching is lost.
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    console.warn(`[feed] полный текст ${item.id} не сохранён: ${message}`);
    return { text: extracted.text, enriched: false, method: extracted.method, error: message };
  }

  console.log(
    `[feed] полный текст ${item.originalUrl}: ${extracted.paragraphs} абзацев, ` +
      `${extracted.text.length} символов (${extracted.method}), было ${item.rawText.length}`,
  );

  return { text: extracted.text, enriched: true, method: extracted.method };
}
