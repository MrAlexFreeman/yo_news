import { ArticleCard } from "@/components/article-card";
import { ForumTopicsBlock } from "@/components/forum-topics";
import { FrontPageHero } from "@/components/front-page-hero";
import { Logo } from "@/components/logo";
import { NewsTicker } from "@/components/news-ticker";
import { OpinionsBlock } from "@/components/opinions-block";
import { SpecTopicBlock } from "@/components/spec-topic-block";
import { SubscribeBlock } from "@/components/subscribe-block";
import { SectionGrid } from "@/components/section-grid";
import { fillRanked, fillSection } from "@/lib/content-loop";
import { getActiveForumTopics } from "@/lib/forum";
import {
  getHeroArticle,
  getMostReadArticles,
  getPublishedArticles,
  getSectionsWithArticles,
  getTrendingArticles,
  type ArticleListItem,
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
/**
 * Cards per rubric strip. Four, because four is what fills the row at `lg`, and a strip
 * of three leaves a one-column hole exactly as bad as a strip of one.
 */
const SECTION_SIZE = 4;
/**
 * Below this a rubric strip is not printed at all.
 *
 * Two, not one: one card under a rubric heading is a link, not a section, and the row it
 * would occupy is mostly paper. The backfill below is what keeps this from firing on a
 * normal day — it only happens when the whole page has run out of material.
 */
const MIN_SECTION_CARDS = 2;
/** Stories in "Другие события дня". Four fill one dense strip. */
const DAY_CARD_COUNT = 4;
/** Threads in "Обсуждают на форуме". Four fills the column without running long. */
const TOPIC_COUNT = 4;
/** Stories in the "Спецтема" block that balances the feed column. */
const SPEC_TOPIC_COUNT = 3;
/** Stories in the "Мнения" block. Three cards with a portrait each. */
const OPINIONS_COUNT = 3;
/**
 * How many candidates the opinion block draws from.
 *
 * Six per card, not one: reads concentrate, so the most-read list overlaps heavily with
 * the stories the hero, the urgent column and the feed have already claimed, and every
 * one of those has to be skipped. Asking for three would return one or none and the
 * block would appear only on days when the paper's popular stories happen to be its least
 * read ones.
 */
const OPINIONS_CANDIDATES = OPINIONS_COUNT * 6;

export default async function HomePage() {
  /*
    Every list on the page comes out of one round of queries, and none of them waits on
    another. `pool` is the deep list: it feeds the rubric strips first and then whatever
    the strips did not take, so "Другие события дня" is what is genuinely left over rather
    than a second draw of the same stories.
  */
  const [
    hero,
    ticker,
    sections,
    pool,
    topics,
    trending,
    mostRead,
    investigations,
    restByReads,
    opinions,
  ] = await Promise.all([
    getHeroArticle(),
    getPublishedArticles(TICKER_FETCH),
    getSectionsWithArticles(SECTION_SIZE, 9),
    getPublishedArticles(160),
    getActiveForumTopics(TOPIC_COUNT),
    getTrendingArticles(URGENT_COUNT + 2),
    getMostReadArticles(URGENT_COUNT * 3),
    getMostReadArticles(SPEC_TOPIC_COUNT, { categorySlug: "investigations" }),
    getMostReadArticles(SPEC_TOPIC_COUNT * 2),
    getMostReadArticles(OPINIONS_CANDIDATES),
  ]);

  const heroId = hero?.id;

  // Everything already on the page. One set, threaded through every block below, is the
  // only way "no headline appears twice on the front page" stays true as blocks are added.
  const used = new Set<string>(heroId ? [heroId] : []);

  const take = (items: readonly ArticleListItem[], limit: number) => {
    const out: ArticleListItem[] = [];
    for (const article of items) {
      if (out.length >= limit) break;
      if (used.has(article.id)) continue;
      out.push(article);
      used.add(article.id);
    }
    return out;
  };

  /*
    "Важное за сегодня" is drawn from the most-read of the last two days rather than from
    the freshest four, because the freshest four are exactly the top of the feed below it:
    a column that repeated the first four rows of the ticker would not be a second
    editorial voice, it would be a copy. "Важное" and "лента" answer different questions.
  */
  const urgentItems = fillRanked(trending, mostRead, URGENT_COUNT);
  for (const article of urgentItems) used.add(article.id);

  const tickerItems = take(ticker, TICKER_COUNT);
  const specItems = fillRanked(investigations, restByReads, SPEC_TOPIC_COUNT);
  for (const article of specItems) used.add(article.id);

  /*
    The opinion column is drawn from all-time reads rather than from the pool, because it
    is not "what is new" — it is "what readers keep coming back to", and a story that was
    published last week may belong here while a story from an hour ago does not. The ids
    still go through `used`, so nothing the reader has already scrolled past is offered a
    second time lower down the page.
  */
  const opinionItems = take(opinions, OPINIONS_COUNT);
  const railItems = take(pool, RAIL_COUNT);

  /*
    Rubric strips, filled.

    `fillSection` takes the rubric's own stories and tops the row up from the pool, so a
    rubric with one article prints a full row instead of one card beside three columns of
    paper. Filler is claimed from the shared `used` set as it is taken, so two strips
    never end up showing the same story, and the filler that reaches a section is
    something no earlier block wanted.
  */
  const visibleSections = sections
    .map((section) => ({
      title: section.category.name,
      slug: section.category.slug,
      articles: fillSection(
        section.articles.filter((article) => !used.has(article.id)),
        pool,
        SECTION_SIZE,
        used,
      ),
    }))
    .filter((section) => section.articles.length >= MIN_SECTION_CARDS);

  // What the strips did not take, freshest first.
  const dayItems = take(pool, DAY_CARD_COUNT);

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

      {/*
        The feed and the column beside it.

        The two are sized against each other on purpose. The feed is ten rows and grows
        with the day; the column used to be one subscribe plate, which left a screen of
        white under it — a layout that reads as broken regardless of what is actually
        in it. Three blocks — the subscription plate, the spec-topic strip and the forum —
        put the column's height within reach of the chronology's without either of them
        pretending to be the other.
      */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NewsTicker articles={tickerItems} now={new Date()} />
        </div>

        {/*
          Normal flow, no sticky: a sticky column painted over the block below it is what
          put the subscribe plate on top of the headlines in the first place.
        */}
        <div className="space-y-6">
          <SpecTopicBlock
            articles={specItems}
            heading="Спецтема"
            headingId="home-spec"
          />

          <SubscribeBlock />

          <OpinionsBlock
            articles={opinionItems}
            headingId="home-opinions"
            now={new Date()}
          />

          <ForumTopicsBlock
            topics={topics}
            heading="Обсуждают на форуме"
            headingId="home-forum"
            accented
          />
        </div>
      </div>

      {/* Rubric strips. Each row is filled to four cards or the section is not printed. */}
      {visibleSections.length > 0 ? (
        <div className="space-y-8">
          {visibleSections.map((section) => (
            <SectionGrid
              key={section.slug}
              title={section.title}
              slug={section.slug}
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
