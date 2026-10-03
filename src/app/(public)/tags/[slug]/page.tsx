import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArticleCard } from "@/components/article-card";
import { plural } from "@/lib/date";
import { PAGE_SIZE } from "@/lib/pagination";
import {
  getArticlesByTag,
  getTagBySlug,
  getTagsWithPublishedArticles,
} from "@/lib/public-queries";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const revalidate = 300;

type PageParams = { slug: string };

type TagPageProps = { params: Promise<PageParams> };

export async function generateStaticParams() {
  // Tags are created by editors, so this is whatever existed at build time; new
  // ones render on demand. Never generates a page: the database is read, so an
  // empty result is the correct "no tags yet", not an error.
  const tags = await getTagsWithPublishedArticles();
  return tags.map((tag) => ({ slug: tag.slug }));
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) return { title: "Тэг не найден", robots: { index: false, follow: false } };

  const description = `Материалы по тегу «${tag.name}» — ${SITE_NAME}. ${SITE_TAGLINE}.`;
  const url = `/tags/${tag.slug}`;

  return {
    title: `${tag.name} — ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${tag.name} — ${SITE_NAME}`, description, url, siteName: SITE_NAME },
  };
}

/**
 * Public listing for one tag.
 *
 * Pagination lives in the path (`/tags/[slug]/page/[n]`) for the same reason the
 * rubric pages do it that way: a `?page=` query string forces dynamic rendering
 * and gives up the CDN cache for a page that only changes when a story is edited.
 */
export default async function TagPage({ params }: TagPageProps) {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  if (!tag) notFound();

  const articles = await getArticlesByTag(tag.slug, PAGE_SIZE);

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <p className="text-xs tracking-wider text-ink-soft uppercase">Тэг</p>
        <h1 className="masthead mt-1 text-3xl text-ink sm:text-4xl">{tag.name}</h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {articles.length}{" "}
          {plural(articles.length, "материал", "материала", "материалов")}
        </p>
      </header>

      {articles.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-soft">
          По этому тэгу пока нет опубликованных материалов.
        </p>
      ) : (
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
      )}
    </div>
  );
}