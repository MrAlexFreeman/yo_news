import type { Metadata } from "next";

import { CategoryListing } from "@/app/(public)/category/[slug]/page";
import {
  countCategoryArticles,
  getCategories,
  getCategoryBySlug,
} from "@/lib/public-queries";
import { totalPages } from "@/lib/pagination";

export const revalidate = 300;

type PageParams = { slug: string; n: string };

/**
 * Pages beyond the first use a path segment rather than `?page=` so they can be
 * prerendered. A query-string page would force dynamic rendering and lose the
 * CDN cache on every request.
 */
export default async function CategoryPagedPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug, n } = await params;
  const page = Math.max(1, Number.parseInt(n, 10) || 1);

  return <CategoryListing slug={slug} page={page} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug, n } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    return {
      title: "Рубрика не найдена",
      robots: { index: false, follow: false },
    };
  }

  const page = Math.max(1, Number.parseInt(n, 10) || 1);
  const title = `«${category.name}» — страница ${page}`;

  return {
    title,
    description: `Материалы рубрики «${category.name}», страница ${page}.`,
    alternates: {
      canonical: `/category/${category.slug}/page/${page}`,
    },
    openGraph: {
      type: "website",
      url: `/category/${category.slug}/page/${page}`,
      title,
    },
  };
}

export async function generateStaticParams(): Promise<PageParams[]> {
  const categories = await getCategories();

  const pages = await Promise.all(
    categories.map(async (category) => ({
      slug: category.slug,
      count: totalPages(await countCategoryArticles(category.id)),
    })),
  );

  return pages.flatMap((category) =>
    Array.from({ length: Math.max(0, category.count - 1) }, (_, index) => ({
      slug: category.slug,
      n: String(index + 2),
    })),
  );
}
