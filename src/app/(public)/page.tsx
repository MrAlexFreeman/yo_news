import { ArticleCard } from "@/components/article-card";
import { Logo } from "@/components/logo";
import { NewsTicker } from "@/components/news-ticker";
import { SubscribeBlock } from "@/components/subscribe-block";
import { SectionGrid } from "@/components/section-grid";
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

const TICKER_COUNT = 12;
const RAIL_COUNT = 4;
const SECTION_SIZE = 4;
/** Stories in "Другие события дня". Four fill the 2×2 grid exactly. */
const DAY_CARD_COUNT = 4;

export default async function HomePage() {
  /*
    One extra list for the "Другие события дня" block. It is fetched separately rather
    than sliced out of the rail's array because it needs stories that appear *nowhere*
    else on the page — hero, ticker, rail and all nine rubric grids included — and
    those are only known after the first four queries resolve.
  */
  const [hero, ticker, sections, rail, dayPool] = await Promise.all([
    getHeroArticle(),
    getPublishedArticles(TICKER_COUNT),
    getSectionsWithArticles(SECTION_SIZE, 9),
    getPublishedArticles(RAIL_COUNT + 8),
    getPublishedArticles(TICKER_COUNT + RAIL_COUNT + 60),
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
                      <ArticleCard key={article.id} article={article} variant="compact" />
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

        {/* Right column: the live ticker, then the syndication block.

            Both are in normal flow with `space-y-6` between them, and the ticker no
            longer pins itself — a sticky feed painted over the block below it, which
            read as the subscribe card sitting on top of the headlines. */}
        <div className="space-y-6">
          <NewsTicker
            articles={tickerItems.slice(0, TICKER_COUNT)}
            now={new Date()}
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
