import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MessageSquare } from "lucide-react";

import { ArticleGallery } from "@/components/article-gallery";
import { ArticleSidebar } from "@/components/article-sidebar";
import { ArticleVideo } from "@/components/article-video";
import { ContinueReading } from "@/components/continue-reading";
import { CoverImage } from "@/components/cover-image";
import { PhotoCredit } from "@/components/photo-credit";
import { ArticleBodyWithCards } from "@/components/entity-card";
import { ReadAlsoBlock } from "@/components/read-also-block";
import { SubscribeBlock } from "@/components/subscribe-block";
import { ViewCounter } from "@/components/view-counter";
import { parseMedia } from "@/lib/article-media";
import { plainTextPreview } from "@/lib/article-html";
import { composeLoopRows, pickStable, splitForLoop } from "@/lib/content-loop";
import { readingMinutes } from "@/lib/reading-time";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/date";
import { forumSectionForArticle } from "@/lib/forum-rubric";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import {
  getLoopHighlights,
  getLoopReadAlso,
  getLoopRubricPopular,
  getPublishedArticleBySlug,
  getPublishedArticles,
} from "@/lib/public-queries";

export const revalidate = 300;

/**
 * How many cards each group of the closing grid shows. Three across on a wide screen is
 * two rows of three — the whole grid — and one per line on a phone.
 */
const LOOP_ROW_SIZE = 3;

/**
 * How many stories each loop query returns. More than the three a row shows, so the page
 * still has three cards left after it has excluded the current story and the one the
 * plate offered, without a second round trip.
 */
const LOOP_CANDIDATES = 5;

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
    // De-duplicated: a story whose rubric is "Спорт" and which also carries a
    // "Спорт" tag would otherwise emit the keyword twice.
    keywords: [
      ...new Set([
        ...(article.category ? [article.category.name] : []),
        ...article.tags.map((entry) => entry.tag.name),
      ]),
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

  const rubricSlug = article.category?.slug ?? null;

  /*
    One round of fetches for the whole engagement loop, and none of them waits on
    another. Three sequential awaits would put the last card three query round trips
    past the first byte of the article, which is the one thing the loop must not do: its
    whole purpose is to be there when the reader reaches the end of the story.

    The candidate lists are longer than the blocks they fill, because the page then
    chooses from them in memory. The plate has to be picked before the grid can exclude
    it, and a second round trip to find that out would be a waterfall over a decision
    that costs a hash.
  */
  const [readAlsoCandidates, popularCandidates, highlightCandidates] = await Promise.all([
    getLoopReadAlso(rubricSlug, article.id, LOOP_CANDIDATES),
    getLoopRubricPopular(rubricSlug, article.id, LOOP_CANDIDATES),
    getLoopHighlights([article.id], LOOP_CANDIDATES),
  ]);

  // One story, chosen by a hash of this article's id: varied between stories, identical
  // for this one on every render, so the cached HTML and the next regeneration agree.
  const plateStory = pickStable(readAlsoCandidates, `${article.id}:plate`);

  // Whatever is already on the page is off limits to the grid: the story being read, and
  // the story the plate just offered.
  const rows = composeLoopRows(
    popularCandidates,
    highlightCandidates,
    [article.id, plateStory?.id ?? null],
    LOOP_ROW_SIZE,
  );

  const body = sanitizeArticleHtml(article.contentHtml);
  const bodySplit = plateStory ? splitForLoop(body, article.id) : null;

  const forumSection = forumSectionForArticle({
    rubricSlug,
    tags: article.tags.map((entry) => entry.tag.name),
  });

  const timestamp = article.publishedAt ?? article.createdAt;

  // Read out of the JSON column here rather than in the query layer, so every
  // caller gets the same defensive parsing for a column that holds anything a
  // hand-written script might have put there.
  const gallery = parseMedia(article.media);
  const videoUrl = article.videoUrl ?? "";

  return (
    /*
      Two columns on a wide screen, one column below `lg`.

      The grid, not a second container: `(public)/layout.tsx` already wraps every page
      in `max-w-7xl` with its own horizontal padding. Adding `mx-auto max-w-7xl px-4`
      here as well would stack the padding and make the article page narrower than
      every other page on the site, which is the opposite of what the wider layout is
      for.

      Sidebar last in the DOM, so on a phone it lands strictly under the story with no
      ordering rule needed to achieve it.
    */
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <article className="min-w-0 lg:col-span-8">
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
              className="font-bold tracking-[0.14em] text-accent uppercase hover:underline decoration-1 underline-offset-4"
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
          /*
            The standfirst. Set apart from the body by size, weight and a rule below,
            because it is the one sentence written to be read twice — once in the feed
            and once here. `border-rule` and `text-ink` are the theme's own tokens
            rather than a slate palette, so the lead follows a brand change.
          */
          <p className="mt-4 mb-6 border-b border-rule pb-4 text-lg leading-relaxed font-medium text-ink sm:text-xl">
            {article.lead}
          </p>
        ) : null}

        {/* The byline: date, reading time, the publication, views — one grey line, the
            way a paper prints its furniture. The photo credit stays separate, under the
            cover, because it belongs to the picture and not to the text. */}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
          <time dateTime={timestamp.toISOString()}>
            {formatDateTime(timestamp)}
          </time>
          <span aria-hidden>·</span>
          <span>{readingMinutes(article.contentHtml)} мин чтения</span>
          <span aria-hidden>·</span>
          <span>{SITE_NAME}</span>
          <span aria-hidden>·</span>
          <ViewCounter
            articleId={article.id}
            initialViews={article.views}
          />
          <span aria-hidden>·</span>
          <a
            href={`mailto:?subject=${encodeURIComponent(article.title)}&body=${encodeURIComponent(absoluteUrl(`/news/${article.slug}`))}`}
            className="hover:text-accent hover:underline decoration-1 underline-offset-4"
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
            // The article cover is the page's LCP element. The sidebar's compact
            // thumbnails are the ones that get lazy-loaded, not this one.
            preload
            sizes="(max-width: 1024px) 100vw, 66vw"
            className="w-full rounded-sm bg-paper-dim"
          />

          {/*
            One caption line, muted.

            The photo credit used to be a second paragraph under the category name,
            which read as two separate captions and left a stray italic row when only
            one of the two fields was filled. They are one sentence: what the picture
            is, and who took it.
          */}
          {article.category?.name || article.photoAuthor || article.photoSource ? (
            <figcaption className="mt-2 text-xs text-ink-soft/80">
              {article.category?.name ?? "Фото"}
              {article.photoAuthor || article.photoSource ? (
                <span className="text-ink-soft/60">
                  {" · "}
                  <PhotoCredit
                    author={article.photoAuthor}
                    source={article.photoSource}
                    stock={{
                      stockPhotoId: article.stockPhotoId,
                      stockAuthorName: article.stockAuthorName,
                      stockAuthorUrl: article.stockAuthorUrl,
                      stockPhotoUrl: article.stockPhotoUrl,
                    }}
                  />
                </span>
              ) : null}
            </figcaption>
          ) : null}
        </figure>
      ) : null}

      {/*
        The body. Authored in the editorial CMS, so it is sanitised before rendering:
        <script>, inline on* handlers and javascript: URLs are removed.

        One container when there is no plate, and three — head, plate, tail — when there
        is. The cut lands after a closing paragraph tag, so each half is a complete
        document and still renders through the same `.article-body` rules; the drop cap
        stays on the first paragraph because it is still the first `<p>` of the first
        half. A short article gets the single container it always had: see
        `splitForLoop`, which returns null rather than a cut it cannot place.
      */}
      {bodySplit && plateStory ? (
        <>
          <ArticleBodyWithCards
            html={bodySplit.before}
            className="article-body drop-cap prose prose-slate mt-6 max-w-none lg:prose-lg"
          />
          <ReadAlsoBlock story={plateStory} />
          <ArticleBodyWithCards
            html={bodySplit.after}
            className="article-body prose prose-slate mt-6 max-w-none lg:prose-lg"
          />
        </>
      ) : (
        <ArticleBodyWithCards
          html={body}
          className="article-body drop-cap prose prose-slate mt-6 max-w-none lg:prose-lg"
        />
      )}

      {videoUrl ? <ArticleVideo url={videoUrl} /> : null}

      {gallery.length > 0 ? (
        <ArticleGallery items={gallery} alt={article.title} />
      ) : null}

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

      {/*
          The end-of-article block: a way into the forum discussion of this story, and
          the story's neighbours. It sits directly after the body and before the tags,
          while the reader still has the argument in mind.
        */}
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-5">
          <Link
            href={`/forum/${forumSection.slug}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            <MessageSquare className="size-4" aria-hidden />
            Обсудить на форуме
          </Link>
          <span className="text-xs text-ink-soft">
            Раздел «{forumSection.title}»
          </span>
        </div>

        {/*
          The closing grid. It replaces the three-card "Читайте также" aside that used to
          sit here: both answered "what else is there", the new one answers it with two
          labelled rows and six cards, and keeping both would put two near-identical
          blocks within a screen of each other.
        */}
        <ContinueReading popular={rows.popular} highlights={rows.highlights} />

        <SubscribeBlock variant="inline" className="mt-10" />
      </article>

      <ArticleSidebar
        currentArticleId={article.id}
        currentTitle={article.title}
        currentUrl={absoluteUrl(`/news/${article.slug}`)}
      />
    </div>
  );
}
