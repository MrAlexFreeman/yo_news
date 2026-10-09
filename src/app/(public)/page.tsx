import { ArticleCard } from "@/components/article-card";
import { ForumTopicsBlock } from "@/components/forum-topics";
import { FrontPageHero } from "@/components/front-page-hero";
import { Logo } from "@/components/logo";
import { NewsTicker } from "@/components/news-ticker";
import { SubscribeBlock } from "@/components/subscribe-block";
import { SectionGrid } from "@/components/section-grid";
import { fillRanked } from "@/lib/content-loop";
import { getActiveForumTopics } from "@/lib/forum";
import {
  getHeroArticle,
  getMostReadArticles,
  getPublishedArticles,
  getSectionsWithArticles,
  getTrendingArticles,
} from "@/lib/public-queries";

/**
 * ISR window for the whole public site. `createArticleAction` calls
 * revalidatePath on save, so editors see changes immediately while anonymous
 * traffic still gets cached HTML.
 */
export const revalidate = 300;

const TICKER_COUNT = 8;
/**
 * The urgent column beside the lead story. Four fills it without running past the
 * lead's own height, which is what keeps the first screen's bottom edge straight.
 */
const URGENT_COUNT = 4;
/**
 * The rail is a summary, not the archive: eight is what a reader will actually scan
 * beside the hero. The rest of the list is one click away under "Вся лента новостей".
 * It used to be twelve, which pushed the subscribe card far enough down that nobody
 * reached it.
 */
/**
 * The lead story plus the four urgent ones are removed from the feed before it renders,
 * and the lead may itself be the newest story, so the feed is fetched with room for all
 * five plus its own eight. Without the spare rows a fresh exclusive hero would cost the
 * rail two lines and the urgent column would show repeats.
 */
const TICKER_FETCH = TICKER_COUNT + URGENT_COUNT + 1;
const RAIL_COUNT = 4;
const SECTION_SIZE = 4;
/** Stories in "Другие события дня". Four fill one dense strip. */
const DAY_CARD_COUNT = 4;
/** Threads in "Обсуждают на форуме". Four fills the column without running long. */
const TOPIC_COUNT = 4;

export default async function HomePage() {
  /*
    One extra list for the "Другие события дня" block. It is fetched separately rather
    than sliced out of the rail's array because it needs stories that appear *nowhere*
    else on the page — hero, urgent column, ticker, rail and all nine rubric grids
    included — and those are only known after the first queries resolve.

    The urgent column is drawn from the most-read of the last two days rather than from
    the freshest four, because the freshest four are exactly the top of the feed below it:
    a column that repeated the first four rows of the ticker would not be a second
    editorial voice, it would be a copy. "Важное" and "лента" answer different questions,
    and the fallback to all time keeps it four long on a quiet day.
  */
  const [hero, ticker, sections, rail, dayPool, topics, trending, mostRead] =
    await Promise.all([
      getHeroArticle(),
      getPublishedArticles(TICKER_FETCH),
      getSectionsWithArticles(SECTION_SIZE, 9),
      getPublishedArticles(RAIL_COUNT + 8),
      getPublishedArticles(TICKER_FETCH + RAIL_COUNT + 60),
      getActiveForumTopics(TOPIC_COUNT),
      getTrendingArticles(URGENT_COUNT + 2, { excludeId: undefined }),
      getMostReadArticles(URGENT_COUNT * 3),
    ]);

  const heroId = hero?.id;
  const urgentItems = fillRanked(
    trending.filter((article) => article.id !== heroId),
    mostRead.filter((article) => article.id !== heroId),
    URGENT_COUNT,
  );
  const urgentIds = new Set(urgentItems.map((article) => article.id));

  const tickerItems = ticker.filter(
    (article) => article.id !== heroId && !urgentIds.has(article.id),
  );
  const railItems = rail
    .filter((article) => article.id !== heroId && !urgentIds.has(article.id))
    .slice(0, RAIL_COUNT);

  // Stories already shown in the hero, the urgent column, the ticker or the rail are
  // dropped from the rubric grids so the same headline does not appear twice on one
  // screen.
  const shown = new Set(
    [
      heroId,
      ...urgentIds,
      ...tickerItems.map((a) => a.id),
      ...railItems.map((a) => a.id),
    ].filter((id): id is string => Boolean(id)),
  );

  // Rubric grids only take stories the hero/ticker/rail have not already shown.
  // A section can end up thin, which is preferable to the same headline
  // appearing twice on one screen. SectionGrid returns null when empty.
  const visibleSections = sections.map((section) => ({
    ...section,
    articles: section.articles.filter((article) => !shown.has(article.id)),
  }));

  /*
    Stories for the strip at the foot of the page.

    Excluded from the rubric grids as well, so this fills the page with material the
    reader has not already scrolled past rather than repeating four headlines they saw
    thirty lines up. The pool is already newest-first, so filtering from the front
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
      {/*
        The top of the page. Asymmetric on purpose: the lead story takes seven of twelve
        columns and the urgent column five, with a hairline between them.
      */}
      {hero ? (
        <FrontPageHero lead={hero} urgent={urgentItems} />
      ) : (
        <div className="rule-double pb-7">
          <div className="rounded-sm border border-dashed border-rule p-10 text-center">
            <h1 className="text-2xl">
              <Logo size="md" />
            </h1>
            <p className="mt-3 text-sm text-ink-soft">
              Опубликованных материалов пока нет. Они появятся здесь сразу
              после публикации в редакции.
            </p>
          </div>
        </div>
      )}

      {/* The live feed, with the forum and the subscription plate in the third column. */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NewsTicker
            articles={tickerItems.slice(0, TICKER_COUNT)}
            now={new Date()}
          />
        </div>

        {/*
          Both blocks are in normal flow with `space-y-6` between them, and the ticker
          no longer pins itself — a sticky feed painted over the block below it, which
          read as the subscribe card sitting on top of the headlines.

          The forum sits above the subscribe plate because a reader who came from a search
          result is often here to see what else is happening, or to argue, not to subscribe.
        */}
        <div className="space-y-6">
          <ForumTopicsBlock
            topics={topics}
            heading="Обсуждают на форуме"
            headingId="home-forum"
            accented
          />

          <SubscribeBlock />
        </div>
      </div>

      {/* Rubric strips. Every rubric is shown; already-placed stories are
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

      {/* Whatever the page has not shown yet, as one more dense strip. */}
      {dayItems.length > 0 ? (
        <section aria-labelledby="day-events" className="border-t-2 border-ink pt-3">
          <h2
            id="day-events"
            className="rubric-line mb-4 text-xs font-bold tracking-[0.14em] text-ink uppercase"
          >
            Другие события дня
          </h2>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {dayItems.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
