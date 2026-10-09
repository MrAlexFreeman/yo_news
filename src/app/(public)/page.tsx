import { ArticleCard } from "@/components/article-card";
import { ForumTopicsBlock } from "@/components/forum-topics";
import { Logo } from "@/components/logo";
import { NowReading } from "@/components/now-reading";
import { OpinionsBlock } from "@/components/opinions-block";
import { RiverArticleCard } from "@/components/river-article-card";
import { SpecTopicBlock } from "@/components/spec-topic-block";
import { SubscribeBlock } from "@/components/subscribe-block";
import { SectionGrid } from "@/components/section-grid";
import { fillRanked, fillSection } from "@/lib/content-loop";
import { getActiveForumTopics } from "@/lib/forum";
import {
  getHeroArticle,
  getMostReadArticles,
  getPublishedArticles,
  getRiverArticles,
  getSectionsWithArticles,
  getTrendingArticles,
} from "@/lib/public-queries";

/**
 * ISR window for the whole public site. `createArticleAction` calls
 * revalidatePath on save, so editors see changes immediately while anonymous
 * traffic still gets cached HTML.
 */
export const revalidate = 300;

/**
 * The river: the lead plus ten.
 *
 * Eleven, and the number is about screen height rather than about coverage. A river card is
 * a headline, a deck, a picture and a caption — roughly 260px at `lg` — so eleven cards is
 * about five screens of reading before the reader reaches anything else on the page. Twelve
 * pushed the first rubric strip below the fold on a laptop, which is the one thing the strips
 * below the river exist to offer.
 */
const RIVER_AFTER_LEAD = 10;
const RIVER_TOTAL = RIVER_AFTER_LEAD + 1;

/** Cards per rubric strip. Four fills one dense row; three leaves a one-column hole. */
const SECTION_SIZE = 4;
/** Below this a rubric strip is not printed at all: one card under a heading is a link. */
const MIN_SECTION_CARDS = 2;
/** Stories in «Другие события дня». */
const DAY_CARD_COUNT = 4;
/** Threads in «Обсуждают на форуме». */
const TOPIC_COUNT = 4;
/** Stories in «Спецтема» in the sidebar. */
const SPEC_TOPIC_COUNT = 3;
/**
 * Candidates for «Спецтема».
 *
 * Wide, and measured rather than guessed: on this database the eleven freshest stories are
 * also eleven of the twelve most-read ones — reads follow the top of the feed, because that
 * is where the readers arrive. A pool of twelve therefore arrived at the sidebar with one
 * usable row and printed one line under a heading that promises three. Twenty-four clears
 * it with room to spare on a quiet day and costs one indexed range scan.
 */
const SPEC_TOPIC_CANDIDATES = SPEC_TOPIC_COUNT * 8;
/** Stories in «Мнения». Three cards with a roundel each. */
const OPINIONS_COUNT = 3;
/** Stories in «Сейчас читают». */
const NOW_READING_COUNT = 5;

/**
 * Candidates per opinion card.
 *
 * Six, not one: reads concentrate, so the most-read list overlaps heavily with what the
 * river has already claimed and each of those has to be skipped. Asking for three would
 * return one or none, and the block would print only on days when the paper's popular
 * stories happen to be its least read ones.
 */
const OPINIONS_CANDIDATES = OPINIONS_COUNT * 6;

/** Candidates per «Сейчас читают» row, for the same reason. */
const NOW_READING_CANDIDATES = NOW_READING_COUNT * 6;

export default async function HomePage() {
  /*
    One round of parallel queries. The lead is fetched before the river in *logic* but not
    in *time*: it cannot be excluded from the river query before it is known, so the river
    is fetched with room for the lead and the lead's id is filtered out afterwards — the
    shared `used` set already claims it on the first line below.
  */
  const [hero, riverRest, sections, pool, topics, trending, mostRead, investigations, specRest] =
    await Promise.all([
      getHeroArticle(),
      getRiverArticles(RIVER_TOTAL),
      getSectionsWithArticles(SECTION_SIZE, 9),
      getPublishedArticles(160),
      getActiveForumTopics(TOPIC_COUNT),
      getTrendingArticles(NOW_READING_CANDIDATES),
      getMostReadArticles(OPINIONS_CANDIDATES),
      getMostReadArticles(SPEC_TOPIC_COUNT, { categorySlug: "investigations" }),
      getMostReadArticles(SPEC_TOPIC_CANDIDATES),
    ]);

  /*
    Everything already on the page. One set threaded through every block is the only way
    "no headline appears twice on the front page" stays true as blocks are added — this was
    a real bug, not a hypothetical: the AI-95 story was linked three times before
    `fillRanked` was taught to read this set.
  */
  const used = new Set<string>(hero ? [hero.id] : []);

  /** The first `limit` unused rows, claimed as they are taken. */
  const take = <T extends { id: string }>(items: readonly T[], limit: number): T[] => {
    const out: T[] = [];
    for (const article of items) {
      if (out.length >= limit) break;
      if (used.has(article.id)) continue;
      out.push(article);
      used.add(article.id);
    }
    return out;
  };

  /*
    The lead leads, then the freshest. Not the lead plus "the next ten most read": a river
    that mixes popularity into its own order stops being a chronology, and a reader who came
    for the news of the hour should not meet yesterday's favourite halfway down.
  */
  const riverBody = take(riverRest, RIVER_AFTER_LEAD);
  const river = hero ? [hero, ...riverBody] : riverBody;

  /*
    The sidebar is drawn after the river and from ranked lists, so anything the river has
    already shown is skipped rather than reprinted a column to the right.
  */
  /*
    «Сейчас читают» needs the same two-tier fallback the article sidebar uses: the last 48
    hours, topped up from all-time reads. Without it the block printed nothing at all — not
    on this site, where the newest material is two days old and the 48-hour window is
    genuinely empty. It is the one block here that looks wrong the moment the news goes
    quiet, because a heading with no rows under it is worse than no heading.
  */
  const nowReading = fillRanked(
    trending,
    mostRead,
    NOW_READING_COUNT,
    used,
  );

  /*
    Drawn after, from the same all-time list, skipping whatever the five rows above claimed.
  */
  const opinions = take(mostRead, OPINIONS_COUNT);

  /*
    `fillRanked` claims its picks in `used` itself, so it is not wrapped in `take`. Wrapping
    it was a bug that returned an empty block every time: `take` skips anything already in
    `used`, which by then held exactly the three stories `fillRanked` had just claimed, so
    the block printed nothing under a heading that promises three. Measured — the sidebar
    had a heading and no rows.
  */
  const specItems = fillRanked(
    investigations,
    specRest,
    SPEC_TOPIC_COUNT,
    used,
  );

  /*
    Rubric strips, filled. `fillSection` takes the rubric's own stories and tops the row up
    from the pool, so a rubric with one article prints a full row instead of one card beside
    three columns of paper. Filler is claimed from the shared `used` set as it is taken.
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

  const dayItems = take(pool, DAY_CARD_COUNT);

  const now = new Date();

  return (
    <div className="space-y-8">
      {/*
        The newspaper grid. Eight columns of river and four of opinion is the split the
        design asks for and the one that works here: the river is the paper's product and it
        gets two thirds, while the sidebar's four blocks stack to about the height of two
        river cards and would look abandoned in half the width.

        `lg:` on the grid and on both spans, so below 1024px this is one column and the
        river reads top to bottom before the sidebar — which is the order a phone wants.
      */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {river.length > 0 ? (
            <section aria-label="Главные материалы" className="border-t-2 border-ink pt-1">
              {river.map((article, index) => (
                <RiverArticleCard
                  key={article.id}
                  article={article}
                  lead={index === 0}
                  now={now}
                />
              ))}
            </section>
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
        </div>

        {/*
          The sidebar. Normal flow, not sticky: a sticky column painted over the block below
          it is what put the subscribe plate on top of the headlines here once already.
        */}
        <div className="space-y-8 lg:col-span-4">
          <OpinionsBlock
            articles={opinions}
            headingId="home-opinions"
            now={now}
          />

          <NowReading articles={nowReading} />

          <SpecTopicBlock
            articles={specItems}
            heading="Спецтема"
            headingId="home-spec"
          />

          <SubscribeBlock />

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