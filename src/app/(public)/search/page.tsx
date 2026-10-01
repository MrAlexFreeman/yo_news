import type { Metadata } from "next";

import { ArticleCard } from "@/components/article-card";
import { SITE_TAGLINE } from "@/lib/site";
import { plural } from "@/lib/date";
import { countSearchResults, searchArticles } from "@/lib/search";

export const metadata: Metadata = {
  title: "Поиск",
  description: `Поиск по архиву материалов. ${SITE_TAGLINE}`,
  // Search result pages must not be indexed.
  robots: { index: false, follow: true },
};

const RESULTS_PER_PAGE = 20;

/** Search uses `?q=`, which is a request-time API, so the page is dynamic. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q ?? "";
  const trimmed = query.trim();

  const [results, total] = await Promise.all([
    searchArticles(trimmed, RESULTS_PER_PAGE),
    countSearchResults(trimmed),
  ]);

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <h1 className="masthead text-3xl text-ink sm:text-4xl">Поиск</h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {trimmed.length < 2
            ? "Введите не менее двух символов."
            : `По запросу «${trimmed}» найдено ${total} ${plural(
                total,
                "материал",
                "материала",
                "материалов",
              )}`}
        </p>
      </header>

      <form role="search" action="/search" className="mt-5 max-w-xl">
        <label htmlFor="q" className="sr-only">
          Поисковый запрос
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Что ищем?"
            className="w-full rounded-sm border border-rule bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            className="shrink-0 rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent"
          >
            Найти
          </button>
        </div>
      </form>

      {trimmed.length >= 2 && results.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-soft">
          Ничего не найдено. Попробуйте другой запрос.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              headingLevel={2}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
