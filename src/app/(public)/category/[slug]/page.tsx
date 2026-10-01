import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleCard } from "@/components/article-card";
import {
  countCategoryArticles,
  getCategories,
  getCategoryArticles,
  getCategoryBySlug,
} from "@/lib/public-queries";
import { plural } from "@/lib/date";
import { PAGE_SIZE, categoryPageHref, totalPages } from "@/lib/pagination";

export const revalidate = 300;

type PageParams = { slug: string };

/** Renders the category grid plus pagination; shared by page 1 and /page/N. */
export async function CategoryListing({
  slug,
  page,
}: {
  slug: string;
  page: number;
}) {
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const total = await countCategoryArticles(category.id);
  const pages = totalPages(total);

  // Out-of-range page numbers fall back to the last page rather than rendering
  // an empty grid under a valid-looking URL.
  const currentPage = Math.min(Math.max(page, 1), pages);

  const articles = await getCategoryArticles(
    category.id,
    PAGE_SIZE,
    (currentPage - 1) * PAGE_SIZE,
  );

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <h1 className="masthead text-3xl text-ink sm:text-4xl">
          {category.name}
        </h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {total} {plural(total, "материал", "материала", "материалов")} ·{" "}
          {pages > 1 ? `страница ${currentPage} из ${pages}` : "одна страница"}
        </p>
      </header>

      {articles.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-soft">
          В этой рубрике пока нет опубликованных материалов.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard
                key={article.id}
                article={article}
                // Only the first card is the LCP candidate; preloading several
                // grid images would compete for bandwidth.
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
                  href={categoryPageHref(category.slug, currentPage - 1)}
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
                        href={categoryPageHref(category.slug, number)}
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
                  href={categoryPageHref(category.slug, currentPage + 1)}
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

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    return {
      title: "Рубрика не найдена",
      robots: { index: false, follow: false },
    };
  }

  const description = `Все опубликованные материалы рубрики «${category.name}».`;

  return {
    title: category.name,
    description,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      type: "website",
      url: `/category/${category.slug}`,
      title: category.name,
      description,
    },
  };
}

export async function generateStaticParams(): Promise<PageParams[]> {
  const categories = await getCategories();
  return categories.map((category) => ({ slug: category.slug }));
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug } = await params;
  return <CategoryListing slug={slug} page={1} />;
}
