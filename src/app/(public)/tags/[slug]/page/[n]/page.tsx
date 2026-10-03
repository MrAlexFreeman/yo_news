import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleCard } from "@/components/article-card";
import { plural } from "@/lib/date";
import { getArticlesByTag, getTagBySlug } from "@/lib/public-queries";
import { PAGE_SIZE, tagsPageHref, totalPages } from "@/lib/pagination";
import { SITE_NAME } from "@/lib/site";

export const revalidate = 300;

type PageParams = { slug: string; n: string };

type TagPageProps = { params: Promise<PageParams> };

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { slug, n } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) return { title: "Тэг не найден", robots: { index: false, follow: false } };

  const page = Math.max(1, Number.parseInt(n, 10) || 1);
  const url = tagsPageHref(tag.slug, page);
  const title =
    page > 1 ? `${tag.name} — страница ${page} — ${SITE_NAME}` : `${tag.name} — ${SITE_NAME}`;
  const description = `Материалы по тегу «${tag.name}» — ${SITE_NAME}.`;

  // Page 1 is the canonical listing; deeper pages canonicalise to themselves so
  // the whole series is crawlable rather than folded onto page 1.
  return {
    title,
    description,
    alternates: { canonical: url },
    // `robots` is set explicitly on both branches. Passing `undefined` left the
    // key present-but-empty in the rendered tag on a live page, which is what
    // made noindex silently not appear.
    robots: { index: true, follow: true },
    openGraph: { title, description, url, siteName: SITE_NAME },
  };
}

/** Deeper pages of a tag listing. Page 1 is `/tags/[slug]`. */
export default async function TagPagedPage({ params }: TagPageProps) {
  const { slug, n } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) notFound();

  const requested = Math.max(1, Number.parseInt(n, 10) || 1);
  const pages = totalPages(tag._count.articles);
  const page = Math.min(requested, pages);

  const articles = await getArticlesByTag(tag.slug, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  if (articles.length === 0) notFound();

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <p className="text-xs tracking-wider text-ink-soft uppercase">Тэг</p>
        <h1 className="masthead mt-1 text-3xl text-ink sm:text-4xl">{tag.name}</h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {tag._count.articles}{" "}
          {plural(tag._count.articles, "материал", "материала", "материалов")} ·
          страница {page} из {pages}
        </p>
      </header>

      <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article, index) => (
          <ArticleCard
            key={article.id}
            article={article}
            preload={index === 0}
            headingLevel={2}
          />
        ))}
      </div>

      {pages > 1 ? (
        <nav
          aria-label="Постраничная навигация"
          className="mt-10 flex items-center justify-between gap-4 border-t border-rule pt-4 text-sm"
        >
          {page > 1 ? (
            <Link
              href={tagsPageHref(tag.slug, page - 1)}
              rel="prev"
              className="font-medium text-accent hover:underline"
            >
              ← Страница {page - 1}
            </Link>
          ) : (
            <span />
          )}

          <ol className="hidden items-center gap-1 sm:flex">
            {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
              <li key={number}>
                <Link
                  href={tagsPageHref(tag.slug, number)}
                  aria-current={number === page ? "page" : undefined}
                  className={
                    number === page
                      ? "rounded-sm bg-ink px-2.5 py-1 text-xs font-semibold text-paper"
                      : "rounded-sm px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-dim"
                  }
                >
                  {number}
                </Link>
              </li>
            ))}
          </ol>

          {page < pages ? (
            <Link
              href={tagsPageHref(tag.slug, page + 1)}
              rel="next"
              className="font-medium text-accent hover:underline"
            >
              Страница {page + 1} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}