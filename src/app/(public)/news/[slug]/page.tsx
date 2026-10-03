import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { ArticleCard } from "@/components/article-card";
import { CoverImage } from "@/components/cover-image";
import { ViewCounter } from "@/components/view-counter";
import { plainTextPreview } from "@/lib/article-html";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/date";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import {
  getPublishedArticleBySlug,
  getPublishedArticles,
  getRelatedArticles,
} from "@/lib/public-queries";

export const revalidate = 300;

type PageParams = { slug: string };

type ArticlePageProps = {
  params: Promise<PageParams>;
};

/** Only published stories are readable; drafts 404 like they do not exist. */
async function loadArticle(slug: string) {
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();
  return article;
}

/** Absolute URL, or null when the field is empty or not a usable http(s) link. */
function canonicalUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);

  // A missing or draft article yields a noindex placeholder; the page itself
  // renders notFound(), so this metadata is only seen by crawlers.
  if (!article) {
    return { title: "Материал не найден", robots: { index: false, follow: false } };
  }

  // Editorial overrides win; otherwise derive from the story, so an unfilled
  // field degrades to something sensible instead of an empty tag.
  const title = article.seoTitle?.trim() || article.title;
  const description =
    article.seoDescription?.trim() ||
    article.lead?.trim() ||
    plainTextPreview(article.contentHtml, 160);
  const url = `/news/${article.slug}`;

  return {
    title,
    description,
    // A reprint points its canonical at the original; everything else is
    // self-canonical.
    alternates: { canonical: canonicalUrl(article.seoCanonicalUrl) ?? url },
    // Both branches are explicit. Passing `undefined` for the indexable case
    // still emitted a robots meta, so an editor toggling noIndex on and off was
    // never sure which state the page was actually in.
    robots: article.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    keywords: [
      ...(article.category ? [article.category.name] : []),
      ...article.tags.map((entry) => entry.tag.name),
    ],
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: "ru_RU",
      publishedTime: (article.publishedAt ?? article.createdAt).toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      ...(article.category ? { section: article.category.name } : {}),
      ...(article.coverImage
        ? { images: [{ url: article.coverImage, alt: article.title }] }
        : {}),
    },
    twitter: {
      card: article.coverImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
      ...(article.coverImage ? { images: [article.coverImage] } : {}),
    },
  };
}

export async function generateStaticParams(): Promise<PageParams[]> {
  // Prebuild the freshest stories; the rest are rendered on demand and cached.
  const articles = await getPublishedArticles(50);
  return articles.map((article) => ({ slug: article.slug }));
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await loadArticle(slug);

  const related = await getRelatedArticles(
    article.category?.slug ?? null,
    article.id,
  );

  const timestamp = article.publishedAt ?? article.createdAt;

  return (
    <article className="mx-auto max-w-3xl">
      {/* Breadcrumbs. */}
      <nav aria-label="Хлебные крошки" className="mb-5 text-[11px] text-ink-soft">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/" className="hover:text-accent">
              Главная
            </Link>
          </li>
          {article.category ? (
            <>
              <li aria-hidden>
                <ChevronRight className="size-3" />
              </li>
              <li>
                <Link
                  href={`/category/${article.category.slug}`}
                  className="hover:text-accent"
                >
                  {article.category.name}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden>
            <ChevronRight className="size-3" />
          </li>
          <li className="clamp-1 text-ink">{article.title}</li>
        </ol>
      </nav>

      <header className="border-b border-rule pb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          {article.category ? (
            <Link
              href={`/category/${article.category.slug}`}
              className="font-semibold tracking-wider text-accent uppercase hover:underline"
            >
              {article.category.name}
            </Link>
          ) : null}
          {article.isExclusive ? (
            <span className="rounded-sm bg-accent px-1.5 py-px text-[9px] font-bold tracking-wide text-white uppercase">
              Эксклюзив
            </span>
          ) : null}
          {article.is18plus ? (
            <span className="rounded-sm border border-ink-soft px-1 py-px text-[9px] font-bold tracking-wide text-ink-soft">
              18+
            </span>
          ) : null}
        </div>

        <h1 className="font-[family-name:var(--font-lora)] text-3xl leading-[1.1] font-bold text-ink sm:text-4xl lg:text-[2.9rem]">
          {article.title}
        </h1>

        {article.subtitle ? (
          <p className="mt-4 font-[family-name:var(--font-lora)] text-xl leading-snug text-ink-soft sm:text-2xl">
            {article.subtitle}
          </p>
        ) : null}

        {article.lead ? (
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            {article.lead}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
          <time dateTime={timestamp.toISOString()}>
            {formatDateTime(timestamp)}
          </time>
          <span aria-hidden>·</span>
          <ViewCounter
            articleId={article.id}
            initialViews={article.views}
          />
          <span aria-hidden>·</span>
          <a
            href={`mailto:?subject=${encodeURIComponent(article.title)}&body=${encodeURIComponent(absoluteUrl(`/news/${article.slug}`))}`}
            className="hover:text-accent"
          >
            Отправить материал
          </a>
        </div>
      </header>

      {article.coverImage ? (
        <figure className="mt-6">
          {/* Goes through next/image like every other cover on the site, so the
              CDN optimises it and the layout keeps its aspect ratio before the
              bytes arrive. CoverImage swaps in the bundled placeholder if the
              stored URL fails, which a server render cannot detect. */}
          <CoverImage
            src={article.coverImage}
            alt={article.title}
            width={1200}
            height={800}
            // The article cover is the page's LCP element.
            preload
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full rounded-sm bg-paper-dim"
          />
          <figcaption className="mt-2 text-[11px] text-ink-soft">
            {article.category?.name ?? "Фото"}
          </figcaption>

          {/* Editorial photo credit, printed under the cover in italics. */}
          {article.photoAuthor || article.photoSource ? (
            <p className="mt-1 text-[11px] text-ink-soft italic">
              {article.photoAuthor ? (
                <span>© {article.photoAuthor}</span>
              ) : null}
              {article.photoAuthor && article.photoSource ? (
                <span aria-hidden> · </span>
              ) : null}
              {article.photoSource ? <span>{article.photoSource}</span> : null}
            </p>
          ) : null}
        </figure>
      ) : null}

      {/* Authored in the editorial CMS, so it is sanitised before rendering:
          <script>, inline on* handlers and javascript: URLs are removed. */}
      <div
        className="article-body prose prose-slate mt-6 max-w-none lg:prose-lg"
        dangerouslySetInnerHTML={{
          __html: sanitizeArticleHtml(article.contentHtml),
        }}
      />

      {article.tags.length > 0 ? (
        <ul
          aria-label="Тэги материала"
          className="mt-6 flex flex-wrap gap-2 border-t border-rule pt-4"
        >
          {article.tags.map((entry) => (
            <li key={entry.tag.id}>
              <Link
                href={`/tags/${entry.tag.slug}`}
                className="inline-flex items-center rounded-full border border-rule bg-paper-dim px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-yo hover:text-yo-ink"
              >
                {entry.tag.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {related.length > 0 ? (
        <aside
          aria-labelledby="related-heading"
          className="mt-10 border-t-2 border-ink pt-4"
        >
          <h2
            id="related-heading"
            className="mb-4 text-xs font-bold tracking-[0.14em] text-ink uppercase"
          >
            Читайте также
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <ArticleCard key={item.id} article={item} variant="compact" />
            ))}
          </div>
        </aside>
      ) : null}
    </article>
  );
}
