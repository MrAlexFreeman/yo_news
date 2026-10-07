import type { Metadata } from "next";
import Link from "next/link";

import { ArticleCard } from "@/components/article-card";
import { plural } from "@/lib/date";
import { newsPageHref, PAGE_SIZE, totalPages } from "@/lib/pagination";
import {
  countPublishedArticles,
  getPublishedArticlesPage,
} from "@/lib/public-queries";

export const revalidate = 300;

/**
 * The full news archive, newest first.
 *
 * This is where the homepage's "Вся лента новостей" link lands. The homepage shows
 * eight stories beside the hero, and before this page existed `/news` resolved to
 * nothing at all — `/news/[slug]` is a story route, not a listing — so that link had
 * nowhere real to go.
 *
 * The nav markup is repeated here rather than shared with the rubric and tag archives.
 * Those two already carry their own copies; folding all three into one component is a
 * refactor of pages this change does not otherwise touch, and it is better made on its
 * own than smuggled in beside a homepage fix.
 */
export async function NewsListing({ page }: { page: number }) {
  const total = await countPublishedArticles();
  const pages = totalPages(total);

  // An out-of-range page falls back to the last one rather than rendering an empty
  // grid under a valid-looking URL — same rule as the rubric archive.
  const currentPage = Math.min(Math.max(page, 1), pages);

  const articles = await getPublishedArticlesPage(
    PAGE_SIZE,
    (currentPage - 1) * PAGE_SIZE,
  );

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <h1 className="masthead text-3xl text-ink sm:text-4xl">Лента новостей</h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {total} {plural(total, "материал", "материала", "материалов")}
          {pages > 1
            ? ` · страница ${currentPage} из ${pages}`
            : " · одна страница"}
        </p>
      </header>

      {articles.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-soft">
          Опубликованных материалов пока нет.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard
                key={article.id}
                article={article}
                // Only the first card is the LCP candidate; preloading the whole grid
                // would make them compete with each other for bandwidth.
                preload={index === 0}
                // Cards follow the page h1 directly, so they take h2.
                headingLevel={2}
              />
            ))}
          </div>

          {pages > 1 ? (
            <nav
              aria-label="Постраничная навигация"
              className="mt-10 flex items-center justify-between gap-4 border-t border-rule pt-4 text-sm"
            >
              {currentPage > 1 ? (
                <Link
                  href={newsPageHref(currentPage - 1)}
                  rel="prev"
                  className="font-medium text-accent hover:underline"
                >
                  ← Страница {currentPage - 1}
                </Link>
              ) : (
                <span />
              )}

              <ol className="hidden items-center gap-1 sm:flex">
                {Array.from({ length: pages }, (_, index) => index + 1).map(
                  (number) => (
                    <li key={number}>
                      <Link
                        href={newsPageHref(number)}
                        aria-current={number === currentPage ? "page" : undefined}
                        className={
                          number === currentPage
                            ? "rounded-sm bg-ink px-2.5 py-1 text-xs font-semibold text-paper"
                            : "rounded-sm px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-dim"
                        }
                      >
                        {number}
                      </Link>
                    </li>
                  ),
                )}
              </ol>

              {currentPage < pages ? (
                <Link
                  href={newsPageHref(currentPage + 1)}
                  rel="next"
                  className="font-medium text-accent hover:underline"
                >
                  Страница {currentPage + 1} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Лента новостей";
  const description =
    "Все опубликованные материалы «Ё-новостей» по порядку выхода.";

  return {
    title,
    description,
    alternates: { canonical: "/news" },
    openGraph: {
      type: "website",
      url: "/news",
      title,
      description,
    },
  };
}

export default async function NewsArchivePage() {
  return <NewsListing page={1} />;
}
