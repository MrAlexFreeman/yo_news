import type { Metadata } from "next";

import { ForumCategoryListing } from "@/app/(public)/forum/[categorySlug]/page";
import { getForumCategories } from "@/lib/forum";
import { parsePageSegment } from "@/lib/pagination";

type PageParams = { categorySlug: string; n: string };

export const revalidate = 120;

/**
 * Deeper pages of a section's thread list.
 *
 * The rendering is imported from the section's own module and not repeated, which is
 * why the section page deliberately does not re-export it: two modules exporting the
 * same component is a Next.js build error.
 */
export async function generateStaticParams() {
  const categories = await getForumCategories();
  const params: { categorySlug: string; n: string }[] = [];

  // Only the sections that can actually paginate. Generating /page/2 for a
  // single-thread section would prerender a page that says "Страница 2 из 1".
  for (const category of categories) {
    if (category.topics <= 20) continue;
    const pages = Math.ceil(category.topics / 20);
    for (let page = 2; page <= pages; page += 1) {
      params.push({ categorySlug: category.slug, n: String(page) });
    }
  }

  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { categorySlug, n } = await params;
  const page = parsePageSegment(n);
  return {
    title: page > 1 ? `Темы — страница ${page}` : "Темы",
    alternates: { canonical: `/forum/${categorySlug}${page > 1 ? `/page/${page}` : ""}` },
    robots: page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function ForumCategoryPageN({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { categorySlug, n } = await params;
  return (
    <ForumCategoryListing
      categorySlug={categorySlug}
      page={parsePageSegment(n)}
    />
  );
}