import Link from "next/link";

import { formatDate, formatTime } from "@/lib/date";

/**
 * "Сейчас читают": the five most-read stories of the last two days, beside the story.
 *
 * Placed at the top of the sidebar's sticky column, which is already pinned at
 * `lg:top-24` with `self-start` — see `article-sidebar.tsx`. A second sticky element
 * inside a sticky parent would never move relative to it, so the block is a normal child
 * of that column rather than a sticky element of its own; the pinning is shared, not
 * duplicated.
 *
 * Below `lg` the sidebar is under the article, where sticking a list of what other people
 * are reading would pin a block the reader has to scroll past to reach anyway. So the
 * component does no pinning of its own and behaves like any other block there.
 */

/** Structural, not the database row: the tests build these from literals. */
type NowReadingStory = {
  id: string;
  slug: string;
  title: string;
  publishedAt: Date | null;
  createdAt: Date;
};

/** Two digits, so the column of numbers stays a straight edge at ten and beyond. */
function rank(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function NowReading({ articles }: { articles: NowReadingStory[] }) {
  if (articles.length === 0) return null;

  return (
    <section aria-labelledby="now-reading-heading">
      {/* The accent bar rather than a pulsing dot: the column already has rules and
          rules on rules, and a blinking element on a page about a news event reads as
          an alert that is not there. */}
      <h2
        id="now-reading-heading"
        className="border-l-2 border-accent pl-2.5 text-xs font-bold tracking-[0.14em] text-ink uppercase"
      >
        Сейчас читают
      </h2>

      <ol className="mt-2 divide-y divide-rule/70">
        {articles.map((article, index) => {
          const timestamp = article.publishedAt ?? article.createdAt;
          return (
            <li key={article.id}>
              <Link
                href={`/news/${article.slug}`}
                className="group flex min-h-11 items-start gap-2.5 py-2.5"
              >
                {/*
                  Decoration, not content: the ordered list already carries the
                  numbering, and `aria-hidden` keeps it from being announced a second
                  time as "1 of 5" followed by "01".
                */}
                <span
                  aria-hidden
                  className="w-6 shrink-0 text-2xl leading-none font-bold tabular-nums text-ink-soft/40"
                >
                  {rank(index)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="clamp-2 block text-sm leading-snug font-medium text-ink transition-colors group-hover:text-accent-ink group-hover:underline decoration-1 underline-offset-4">
                    {article.title}
                  </span>
                  <time
                    dateTime={timestamp.toISOString()}
                    className="mt-1 block text-[11px] tabular-nums text-ink-soft"
                  >
                    {formatDate(timestamp)}, {formatTime(timestamp)}
                  </time>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}