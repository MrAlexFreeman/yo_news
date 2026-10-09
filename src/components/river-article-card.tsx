import Link from "next/link";

import { RubricLabel } from "@/components/article-card";
import { CoverImage } from "@/components/cover-image";
import { plainTextPreview } from "@/lib/article-html";
import { formatRelative, formatTime } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";
import { readingMinutes } from "@/lib/reading-time";
import { cn } from "@/lib/utils";

/**
 * One story in the river: text on the left, the photograph on the right.
 *
 * The proportion is 40/60 rather than the other way round because the photograph is what
 * stops the reader's eye here, and the headline only has to be read, not scanned. Giving
 * the text 40% of an eight-column track leaves it about 380px at 1280 — enough for a
 * three-line Lora headline at 24px without the hyphenation breaking words in half.
 *
 * `flex-col-reverse` is what puts the picture on top on a phone. It looks like a flourish
 * and is not: written as `flex-col` the DOM would read text-first on every viewport, and
 * order has to be expressed once, in the markup, rather than fought with two breakpoints.
 * `reverse` on the small axis plus `md:flex-row` on the large one gives the same DOM both
 * layouts.
 *
 * A story with no photograph drops the image and runs the text across the full width at the
 * river's own type sizes. It is not given a grey plate and it is not squeezed into the 40%
 * column: a headline alone is wide enough to set at 24px, and a card that reserves space
 * for a picture that will never arrive is a hole in the column. `Article` has one image
 * field, `coverImage` — there is no `imageUrl` to fall back to.
 */
export function RiverArticleCard({
  article,
  lead = false,
  now,
}: {
  article: RiverStory;
  /** The first card in the river: one step larger, which is the whole of its promotion. */
  lead?: boolean;
  /** Frozen so a prerendered page keeps a stable "2 часа назад". */
  now: Date;
}) {
  const timestamp = article.publishedAt ?? article.createdAt;
  const hasImage = Boolean(article.coverImage);
  const standfirst = riverStandfirst(article);

  const credit = [article.photoSource, article.photoAuthor]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");

  return (
    <article
      className={cn(
        "group flex flex-col-reverse items-start gap-4 border-b border-rule/70 md:flex-row md:gap-6",
        lead ? "pt-0 pb-7" : "py-6",
      )}
    >
      {/*
        Text. `md:basis-2/5` rather than a percentage width: a basis is a share of the flex
        container, so it stays 40% of whatever the column is at any width, while
        `md:w-[40%]` would measure against the parent's content box and leave the gap
        unaccounted for.

        The basis is applied *only when there is a photograph*. With none, the row has a
        single child, and a lone child still carrying `md:basis-2/5` leaves 60% of the
        column as empty paper beside a headline — the grey-rectangle complaint in reverse:
        not a box where a picture should be, but bare space where a headline should be.
      */}
      <div
        className={cn(
          "flex w-full flex-col",
          hasImage && "md:basis-2/5",
        )}
      >
        {article.category ? (
          <RubricLabel
            name={article.category.name}
            slug={article.category.slug}
            className={cn("text-accent", lead ? "mb-2" : "mb-1.5")}
          />
        ) : null}

        <h2
          className={cn(
            "font-[family-name:var(--font-lora)] font-bold tracking-tight text-ink",
            lead
              ? "text-2xl leading-tight lg:text-3xl"
              : "text-xl leading-snug md:text-2xl",
          )}
        >
          <Link
            href={`/news/${article.slug}`}
            className="transition-colors hover:text-accent hover:underline decoration-1 underline-offset-4 group-hover:text-accent group-hover:underline"
          >
            {article.title}
          </Link>
        </h2>

        {/*
          The deck. Falls back to the opening of the body when the editor wrote no lead,
          which is the common case for syndicated material — without it a third of the river
          would be a headline with nothing under it and the column would read as a list of
          links rather than as journalism.
        */}
        {standfirst ? (
          <p className="clamp-3 mt-2 text-sm leading-relaxed text-ink-soft">
            {standfirst}
          </p>
        ) : null}

        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-soft">
          <time dateTime={timestamp.toISOString()}>
            {formatRelative(timestamp, now)}
          </time>
          <span aria-hidden>·</span>
          <time dateTime={timestamp.toISOString()} className="tabular-nums">
            {formatTime(timestamp)}
          </time>
          <span aria-hidden>·</span>
          <span>{readingMinutes(article.contentHtml)} мин</span>
        </p>
      </div>

      {/*
        The picture. `md:basis-3/5` is the other 60%, and `shrink-0` on the media wrapper
        keeps the text from pushing it narrower on a long Russian headline.

        `relative` on the frame is load-bearing, and this is the bug that made the first
        photograph fill the screen. `CoverImage` renders a Next `<Image fill>`, which is
        `position: absolute; inset: 0` — it positions itself against the nearest positioned
        ancestor, not against its own box. With no `relative` here the nearest one was the
        initial containing block, so all eleven images in the river stacked on top of each
        other at the top of the document: the first screen was one enormous photograph, and
        every card below it kept an empty grey frame where its own image should have been.

        `max-h` caps what `aspect-video` computes. Eight columns of a 1280 page is ~790px
        wide, and 790/16:9 is 444px — taller than the fold, so the headline and its deck
        fell below it. The ratio alone is not a height limit.
      */}
      {hasImage ? (
        <div className="w-full shrink-0 md:basis-3/5">
          <Link
            href={`/news/${article.slug}`}
            tabIndex={-1}
            aria-hidden
            className="relative block aspect-video max-h-[360px] w-full overflow-hidden rounded-sm bg-paper-dim md:max-h-[380px]"
          >
            <CoverImage
              src={article.coverImage as string}
              alt=""
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 460px"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          </Link>

          {credit ? (
            <p className="mt-1 text-[11px] text-ink-soft">{credit}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The standfirst a river card prints when the article has neither `lead` nor `subtitle`.
 *
 * Exported so the page can decide, once, whether a card is worth its own deck line rather
 * than every card deciding separately — `plainTextPreview` is not cheap enough to run per
 * card on a list of eleven.
 */
export function riverStandfirst(
  article: Pick<RiverStory, "lead" | "subtitle" | "contentHtml">,
): string | null {
  return (
    article.lead ??
    article.subtitle ??
    plainTextPreview(article.contentHtml, 220)
  );
}

/**
 * Structural, not the database row: the tests build these from literals.
 *
 * `ArticleListItem` has no `contentHtml`, so the river's own row type adds it rather than
 * widening the list type — every other list on the site would inherit the body for nothing.
 */
export type RiverStory = ArticleListItem & { contentHtml: string };