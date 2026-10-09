import Link from "next/link";

import { CoverImage } from "@/components/cover-image";
import { RubricLabel } from "@/components/article-card";
import { formatDate, formatTime } from "@/lib/date";
import { readingMinutes } from "@/lib/reading-time";

/**
 * One card of the closing "Продолжить чтение" grid.
 *
 * The same furniture as every other card on the site — rubric in caps, headline that
 * reacts, date — plus two things this block needs and a list card does not: a 16:9
 * picture, because these are six at a time and the grid is the last thing on the page,
 * so it has to be scannable at a glance; and a reading time, because by this point the
 * reader is choosing between stories rather than reading one.
 *
 * `min-h-10` on the headline link, against 24px minimum in WCAG 2.2: a two-line headline
 * at 15px is already taller than that on desktop, but a single-line one is not.
 */

/** Structural, not the database row: the tests build these from literals. */
export type LoopCardStory = {
  id: string;
  slug: string;
  title: string;
  coverImage: string | null;
  contentHtml: string;
  publishedAt: Date | null;
  createdAt: Date;
  category: { name: string; slug: string } | null;
};

/**
 * Bundled fallback for a story with no cover. `CoverImage` swaps to the same file when
 * a stored URL fails, so pointing at it directly keeps the frame's aspect ratio instead
 * of collapsing to a line of text inside a grid cell.
 */
const NO_COVER = "/placeholder.png";

export function LoopCard({ story }: { story: LoopCardStory }) {
  const timestamp = story.publishedAt ?? story.createdAt;

  return (
    <article className="group flex h-full flex-col">
      <Link
        href={`/news/${story.slug}`}
        tabIndex={-1}
        aria-hidden
        className="relative block aspect-video w-full overflow-hidden rounded-sm bg-paper-dim"
      >
        <CoverImage
          src={story.coverImage ?? NO_COVER}
          alt=""
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform group-hover:scale-[1.02]"
        />
      </Link>

      <div className="mt-2.5 flex flex-1 flex-col">
        {story.category ? (
          <RubricLabel
            name={story.category.name}
            slug={story.category.slug}
            className="mb-1.5"
          />
        ) : null}

        <h3 className="clamp-3 font-[family-name:var(--font-lora)] text-sm leading-snug font-bold text-ink">
          <Link
            href={`/news/${story.slug}`}
            className="inline-flex min-h-10 items-start transition-colors hover:text-accent hover:underline decoration-1 underline-offset-4"
          >
            {story.title}
          </Link>
        </h3>

        <p className="mt-auto pt-2 text-[11px] tabular-nums text-ink-soft">
          <time dateTime={timestamp.toISOString()}>
            {formatDate(timestamp)}, {formatTime(timestamp)}
          </time>
          {" · "}
          {readingMinutes(story.contentHtml)} мин
        </p>
      </div>
    </article>
  );
}