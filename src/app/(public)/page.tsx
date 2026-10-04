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

export default async function HomePage() {
  const [hero, ticker, sections, rail] = await Promise.all([
    getHeroArticle(),
    getPublishedArticles(TICKER_COUNT),
    getSectionsWithArticles(SECTION_SIZE, 9),
    getPublishedArticles(RAIL_COUNT + 8),
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

  return (
    <div className="space-y-8">
      {/* Hero + live ticker. */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {hero ? (
            <ArticleCard article={hero} variant="lead" preload />
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

        {/* Right column: the live ticker, then the syndication block. Both sit
            under the hero rather than beside it, because the hero is the one
            element on this page that must stay full width. */}
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
