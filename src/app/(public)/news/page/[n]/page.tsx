import type { Metadata } from "next";

import { NewsListing } from "@/app/(public)/news/page";
import { countPublishedArticles } from "@/lib/public-queries";
import { totalPages } from "@/lib/pagination";

export const revalidate = 300;

type PageParams = { n: string };

/**
 * Deeper pages of the news archive.
 *
 * The rendering is imported from `/news` rather than repeated, which is why that module
 * exports `NewsListing` separately: two modules exporting the same component is a
 * Next.js build error.
 *
 * These pages carry `noindex, follow`. Page 1 is linked from the homepage and every
 * deeper page is reachable from it, but letting every slice of a chronologically
 * ordered list into the index makes it compete with the stories themselves for the
 * same queries. The rubric archives are allowed to stay indexed because a rubric is a
 * topic someone searches for; "page 4 of everything" is not.
 */
export default async function NewsArchivePageN({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { n } = await params;
  return <NewsListing page={Math.max(1, Number.parseInt(n, 10) || 1)} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { n } = await params;
  const page = Math.max(1, Number.parseInt(n, 10) || 1);
  const title = `Лента новостей — страница ${page}`;

  return {
    title,
    description: `Опубликованные материалы «Ё-новостей», страница ${page}.`,
    alternates: { canonical: `/news/page/${page}` },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      url: `/news/page/${page}`,
      title,
    },
  };
}

export async function generateStaticParams(): Promise<PageParams[]> {
  const pages = totalPages(await countPublishedArticles());

  return Array.from({ length: Math.max(0, pages - 1) }, (_, index) => ({
    n: String(index + 2),
  }));
}
