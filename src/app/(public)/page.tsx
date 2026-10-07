import { ArticleCard } from "@/components/article-card";
import { ForumTopicsBlock } from "@/components/forum-topics";
import { Logo } from "@/components/logo";
import { NewsTicker } from "@/components/news-ticker";
import { SubscribeBlock } from "@/components/subscribe-block";
import { SectionGrid } from "@/components/section-grid";
import { getActiveForumTopics } from "@/lib/forum";
import {
  getHeroArticle,
  getPublishedArticles,
  getSectionsWithArticles,
} from "@/lib/public-queries";

/**
 * ISR window for the whole public site. `createArticleAction` calls
 * revalidatePath on save, so editors see changes immediately while anonymous
 * traffic still gets cached HTML.
 */
export const revalidate = 300;

/*
  The rail is a summary, not the archive: eight is what a reader will actually scan
  beside the hero. The rest of the list is one click away under "Вся лента новостей".
  It used to be twelve, which pushed the subscribe card far enough down that nobody
  reached it.
*/
const TICKER_COUNT = 8;
/**
 * One more than the count above, because the hero is subtracted from the feed
 * afterwards. Without the spare row a fresh exclusive hero — which is also the
 * newest story — would cost the rail a line and it would show seven rows instead of
 * eight.
 */
const TICKER_FETCH = TICKER_COUNT + 1;
const RAIL_COUNT = 4;
const SECTION_SIZE = 4;
/** Stories in "Другие события дня". Four fill the 2×2 grid exactly. */
const DAY_CARD_COUNT = 4;
/** Threads in "Обсуждают на форуме". Four fills the column without running long. */
const TOPIC_COUNT = 4;

export default async function HomePage() {
  /*
    One extra list for the "Другие события дня" block. It is fetched separately rather
    than sliced out of the rail's array because it needs stories that appear *nowhere*
    else on the page — hero, ticker, rail and all nine rubric grids included — and
    those are only known after the first four queries resolve.
  */
  const [hero, ticker, sections, rail, dayPool, topics] = await Promise.all([
    getHeroArticle(),
    getPublishedArticles(TICKER_FETCH),
    getSectionsWithArticles(SECTION_SIZE, 9),
    getPublishedArticles(RAIL_COUNT + 8),
    getPublishedArticles(TICKER_FETCH + RAIL_COUNT + 60),
    getActiveForumTopics(TOPIC_COUNT),
  ]);

  const heroId = hero?.id;
  const tickerItems = ticker.filter((article) => article.id !== heroId);
  const railItems = rail
    .filter((article) => article.id !== heroId)
    .slice(0, RAIL_COUNT);

  // Stories already shown in the hero, ticker or rail are dropped from the
  // rubric grids so the same headline does not appear twice on one screen.
  const shown = new Set(
    [heroId, ...tickerItems.map((a) => a.id), ...railItems.map((a) => a.id)].filter(
      (id): id is string => Boolean(id),
    ),
  );

  // Rubric grids only take stories the hero/ticker/rail have not already shown.
  // A section can end up thin, which is preferable to the same headline
  // appearing twice on one screen. SectionGrid returns null when empty.
  const visibleSections = sections.map((section) => ({
    ...section,
    articles: section.articles.filter((article) => !shown.has(article.id)),
  }));

  /*
    Stories for the 2×2 block under the hero.

    Excluded from the rubric grids as well, so this fills the left column with material
    the reader has not already scrolled past rather than repeating four headlines they
    saw thirty lines up. The pool is already newest-first, so filtering from the front
    yields the freshest leftovers.
  */
  const inSections = new Set(
    visibleSections.flatMap((section) =>
      section.articles.map((article) => article.id),
    ),
  );
  const dayItems = dayPool
    .filter((article) => !shown.has(article.id) && !inSections.has(article.id))
    .slice(0, DAY_CARD_COUNT);

  return (
    <div className="space-y-8">
      {/* Hero + live ticker. */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {hero ? (
            <>
              <ArticleCard article={hero} variant="lead" preload />

              {/*
                The hero is one tall card and the feed beside it is twelve rows, so the
                left column used to end early and leave a bare white rectangle under it —
                the emptiest part of the page and the first thing seen. These four
                stories fill it with material that appears nowhere else on the screen.
              */}
              {dayItems.length > 0 ? (
                <section aria-labelledby="day-events" className="mt-6">
                  <h2
                    id="day-events"
                    className="mb-3 border-b-2 border-ink pb-1 text-xs font-bold tracking-[0.14em] text-ink uppercase"
                  >
                    Другие события дня
                  </h2>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {dayItems.map((article) => (
                      <ArticleCard
                        key={article.id}
                        article={article}
                        variant="compact"
                        // These slots are half the width of the page, so the rail's 80px
                        // square reads as a stamp rather than as a picture of the story.
                        preview="lg"
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="rounded-sm border border-dashed border-rule p-10 text-center">
              <h1 className="text-2xl">
                <Logo size="md" />
              </h1>
              <p className="mt-3 text-sm text-ink-soft">
                Опубликованных материалов пока нет. Они появятся здесь сразу
                после публикации в редакции.
              </p>
            </div>
          )}
        </div>

        {/* Right column: the live ticker, the forum, then the syndication block.

            All three are in normal flow with `space-y-6` between them, and the ticker
            no longer pins itself — a sticky feed painted over the block below it, which
            read as the subscribe card sitting on top of the headlines. */}
        <div className="space-y-6">
          <NewsTicker
            articles={tickerItems.slice(0, TICKER_COUNT)}
            now={new Date()}
          />

          {/*
            Between the feed and the subscribe card, and not after it: the subscribe
            block is the last thing a reader should meet on this page. The forum sits
            where the reader is already looking — the same two blocks the article
            sidebar carries, so the site's conversations are visible from the front
            page and not only from inside a story.
          */}
          <ForumTopicsBlock
            topics={topics}
            heading="Обсуждают на форуме"
            headingId="home-forum"
            accented
          />

          <SubscribeBlock />
        </div>
      </div>

      {/* Reading rail. */}
      {railItems.length > 0 ? (
        <section aria-labelledby="reading-rail" className="border-t-2 border-ink pt-3">
          <h2
            id="reading-rail"
            className="mb-3 text-xs font-bold tracking-[0.14em] text-ink uppercase"
          >
            Читайте сейчас
          </h2>
          <div className="grid gap-x-6 divide-y divide-rule/70 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
            {railItems.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                variant="compact"
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Rubric grids. Every rubric is shown; already-placed stories are
          filtered out so nothing repeats within one screen. */}
      {visibleSections.length > 0 ? (
        <div className="space-y-8">
          {visibleSections.map((section) => (
            <SectionGrid
              key={section.category.slug}
              title={section.category.name}
              slug={section.category.slug}
              articles={section.articles}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
