import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { ArticleGallery } from "@/components/article-gallery";
import { ArticleSidebar } from "@/components/article-sidebar";
import { ArticleVideo } from "@/components/article-video";
import { CoverImage } from "@/components/cover-image";
import { PhotoCredit } from "@/components/photo-credit";
import { ArticleBodyWithCards } from "@/components/entity-card";
import { ReadingProgress } from "@/components/reading-progress";
import { PersonalizedContinueReading } from "@/components/personalized-continue-reading";
import { ReadAlsoBlock } from "@/components/read-also-block";
import { ReaderStoryForm } from "@/components/reader-story-form";
import { ArticlePoll } from "@/components/article-poll";
import { SubscribeBlock } from "@/components/subscribe-block";
import { ViewCounter } from "@/components/view-counter";
import type { LoopCardStory } from "@/components/loop-card";
import { parseMedia } from "@/lib/article-media";
import { plainTextPreview, stripTrailingKicker } from "@/lib/article-html";
import { composeLoopRows, pickStable, splitForLoop } from "@/lib/content-loop";
import { automaticPlateAllowed, splitAroundReadAlso } from "@/lib/read-also";
import { readingMinutes } from "@/lib/reading-time";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/date";
import { forumSectionForArticle } from "@/lib/forum-rubric";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import {
  getLoopFresh,
  getLoopHighlights,
  getLoopReadAlso,
  getArticlePoll,
  getLoopRubricPopular,
  getLoopStoriesBySlugs,
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
 * How many stories each loop query returns, and how deep the pool behind each row is.
 *
 * More than the three a row shows, and now for two reasons rather than one. The page still has
 * to be able to exclude the story being read and the one the plate offered — and the grid is
 * filtered again in the browser against the stories this reader has already opened, which can
 * remove all three of the first cards. A pool of three would leave that reader with an empty
 * row; a pool of eight leaves them a choice.
 */
const LOOP_CANDIDATES = 8;
const LOOP_POOL_SIZE = 8;
const LOOP_POPULAR_CANDIDATES = 8;
const LOOP_HIGHLIGHT_CANDIDATES = 8;
/** The second row's reserve, because its own list overlaps the first row's almost entirely. */
const LOOP_FRESH_CANDIDATES = 12;

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
  const [articlePoll, readAlsoCandidates, popularCandidates, highlightCandidates, freshCandidates] =
    await Promise.all([
      getArticlePoll(article.id),
      getLoopReadAlso(rubricSlug, article.id, LOOP_CANDIDATES),
      getLoopRubricPopular(rubricSlug, article.id, LOOP_POPULAR_CANDIDATES),
      getLoopHighlights([article.id], LOOP_HIGHLIGHT_CANDIDATES),
      // The freshest material on the site, as the second row's reserve.
      //
      // Both rows used to be drawn from "popular" and both were three cards, so the second row
      // could be topped up from the first row's leftovers and nobody noticed the two lists were
      // the same stories in nearly the same order. Deepening the rows to a pool of eight is what
      // exposed it: the first row now takes all eight of its own, and a second row whose list is
      // the same eight in a different order is left showing one card.
      //
      // So the second row gets a source that is not popularity — the day's freshest stories,
      // which is also the fallback the block is supposed to have when a rubric runs dry.
      getLoopFresh(article.id, LOOP_FRESH_CANDIDATES),
    ]);

  /*
    The body, cleaned of a dangling kicker before anything is decided about it.

    The strip runs on the sanitised body, and before the split, so a «Читайте также:» left at
    the end is neither rendered nor counted as a paragraph the plate could be placed after.
    See `stripTrailingKicker` for what it does and does not touch.
  */
  const body = stripTrailingKicker(sanitizeArticleHtml(article.contentHtml));

  /*
    The body, taken apart at whatever plates it carries — read once, from the sanitised
    body rather than the stored one, so there is a single answer to "does this article
    have a hand-placed plate" instead of two that could disagree if sanitising ever
    changes.
  */
  const bodyParts = splitAroundReadAlso(body);
  const manualMarkers = bodyParts.filter(
    (part): part is Extract<typeof part, { kind: "readAlso" }> => part.kind === "readAlso",
  );

  /*
    One story, chosen by a hash of this article's id: varied between stories, identical
    for this one on every render, so the cached HTML and the next regeneration agree.

    The rule itself is in `lib/read-also.ts`; what matters here is that a hand-placed plate
    always wins over an automatic one, whatever the flag says.
  */
  const plateStory = automaticPlateAllowed(article.autoRelatedArticle, manualMarkers.length)
    ? pickStable(readAlsoCandidates, `${article.id}:plate`)
    : null;

  /*
    The stories a hand-placed plate points at, so those plates render from live rows —
    with the cover the story has now, not the one it had when the editor placed it — and
    therefore through the same component as the automatic one.

    Plain code rather than a memo: this is a server component, it runs once per render,
    and a hook cannot await. An empty list answers without querying, so every article
    without a hand-placed plate pays nothing for this.
  */
  const manualStories = new Map(
    (
      await getLoopStoriesBySlugs(manualMarkers.map((marker) => marker.slug))
    ).map((story) => [story.slug, story]),
  );

  // Whatever is already on the page is off limits to the grid: the story being read, and
  // the story the plate just offered.
  const rows = composeLoopRows(
    popularCandidates,
    // The second row's own list first, then the freshest stories as its reserve: a row of one
    // card under a heading reads as a failed request, and this is the list that can be empty
    // when the first row and it are drawing on the same stories.
    [...highlightCandidates, ...freshCandidates],
    [article.id, plateStory?.id ?? null],
    LOOP_POOL_SIZE,
  );

  /**
   * A database row as a card, with the reading time computed here and the body left behind.
   *
   * `LoopCardStory` carries no `contentHtml` on purpose: the grid's cards cross to the browser
   * so they can be filtered by what the reader has already opened, and eight article bodies in
   * the RSC payload would be more bytes than the rest of the page put together.
   */
  const toCard = (story: (typeof rows.popular)[number]): LoopCardStory => {
    const { contentHtml, ...rest } = story;
    return { ...rest, minutes: readingMinutes(contentHtml) };
  };

  /*
    The body, in pieces, with the plates already decided.

    Three shapes, and the third is why this is not just the old two-way split:

      no plate            → one `ArticleBodyWithCards`, exactly as before
      automatic plate     → before / plate / after, cut after the second or third paragraph
      hand-placed plates  → a run of body parts interleaved with plates at the editor's
                            own positions

    `bodyParts` already holds the hand-placed case, so the render below picks whichever of
    the three applies rather than splitting again.
  */
  const bodySplit =
    manualMarkers.length > 0 || !plateStory ? null : splitForLoop(body, article.id);

  /**
   * A body part, with the drop cap on the first.
   *
   * The cap is a style on `.article-body` and only means anything on the first paragraph
   * of the article, so it goes on the first part and nowhere else. Tracked in a counter
   * rather than an index because the plate between two parts must not consume one.
   */
  let bodyPartIndex = 0;
  const renderBodyPart = (html: string, key: string) => {
    const isFirst = bodyPartIndex === 0;
    bodyPartIndex += 1;
    return (
      <ArticleBodyWithCards
        key={key}
        html={html}
        className={
          isFirst
            ? "article-body drop-cap prose prose-slate mt-6 max-w-[44rem] lg:prose-lg"
            : "article-body prose prose-slate mt-6 max-w-[44rem] lg:prose-lg"
        }
      />
    );
  };

  /**
   * A hand-placed plate, rendered from the live row where one still exists.
   *
   * The stored title wins over the row's: it is what the editor wrote beside the block,
   * and a plate announcing something the headline has since been edited to would look
   * like a stale page rather than like a plate. The cover, the reading time and the rubric
   * can only come from the row — which is the reason the block stores just a slug.
   */
  const renderManualPlate = (slug: string, storedTitle: string, key: string) => {
    const row = manualStories.get(slug);
    return (
      <ReadAlsoBlock
        key={key}
        story={{
          slug,
          title: storedTitle || row?.title || slug,
          contentHtml: row?.contentHtml ?? "",
          coverImage: row?.coverImage ?? null,
          category: row?.category ?? null,
        }}
      />
    );
  };

  const bodySplitNode = (() => {
    if (manualMarkers.length > 0) {
      return bodyParts.map((part, index) =>
        part.kind === "body"
          ? renderBodyPart(part.html, `manual-body-${index}`)
          : renderManualPlate(part.slug, part.title, `manual-plate-${index}`),
      );
    }

    if (bodySplit && plateStory) {
      return [
        renderBodyPart(bodySplit.before, "auto-body-before"),
        <ReadAlsoBlock key="auto-plate" story={plateStory} />,
        renderBodyPart(bodySplit.after, "auto-body-after"),
      ];
    }

    return renderBodyPart(body, "body");
  })();

  const timestamp = article.publishedAt ?? article.createdAt;

  // Read out of the JSON column here rather than in the query layer, so every
  // caller gets the same defensive parsing for a column that holds anything a
  // hand-written script might have put there.
  const gallery = parseMedia(article.media);
  const videoUrl = article.videoUrl ?? "";

  return (
    <>
      {/*
        Two columns on a wide screen, one column below `lg`.

        The grid, not a second container: `(public)/layout.tsx` already wraps every page
        in `max-w-7xl` with its own horizontal padding. Adding `mx-auto max-w-7xl px-4`
        here as well would stack the padding and make the article page narrower than
        every other page on the site, which is the opposite of what the wider layout is
        for.

        Sidebar last in the DOM, so on a phone it lands strictly under the story with no
        ordering rule needed to achieve it.
      */}
      <ReadingProgress targetId="article" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <article id="article" className="min-w-0 lg:col-span-8">
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
      {bodySplitNode}

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
          The end-of-article block. It used to be a button into the forum plus the rubric name
          beside it — «Раздел «Городские проблемы и ЖКХ»» printed under every story, whether or
          not the story had anything to do with housing. The editor asked for the rubric to go
          and for the block to ask the reader for something instead, so this is the form that
          files a reader's story into «Новости и события». See `ReaderStoryForm`.
        */}
        {articlePoll ? <ArticlePoll poll={articlePoll} /> : null}
        <ReaderStoryForm />

        {/*
          The closing grid. It replaces the three-card "Читайте также" aside that used to
          sit here: both answered "what else is there", the new one answers it with two
          labelled rows and six cards, and keeping both would put two near-identical
          blocks within a screen of each other.

          It is handed a pool rather than exactly six cards and reorders it in the reader's
          browser, so a story they have already opened is not offered back to them. See
          `PersonalizedContinueReading`.
        */}
        <PersonalizedContinueReading
          currentSlug={article.slug}
          popular={rows.popular.map(toCard)}
          highlights={rows.highlights.map(toCard)}
          rowSize={LOOP_ROW_SIZE}
        />

        <SubscribeBlock variant="inline" className="mt-10" />
      </article>

      <ArticleSidebar
        currentArticleId={article.id}
        currentTitle={article.title}
        currentUrl={absoluteUrl(`/news/${article.slug}`)}
      />
      </div>
    </>
  );
}
