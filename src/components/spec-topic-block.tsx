import Link from "next/link";

import { RubricLabel } from "@/components/article-card";
import { formatDate } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";

/**
 * The block that makes the feed column as tall as the feed.
 *
 * The left column of that row is a chronology of ten rows; the right was one subscribe
 * plate under a screen of nothing. A column whose height is a third of its neighbour's
 * reads as a layout that failed to load, whatever is actually in it.
 *
 * Three stories with serif headlines and no photographs. No pictures is the point: this
 * sits directly under a plate of links and beside a column of nothing but text, and three
 * grey rectangles would have made the hole again in a smaller size.
 *
 * The heading says "Спецтема" and not "Расследования" because the block is filled from
 * investigations *first* and from the rest of the paper when there are not three — and a
 * heading that names a rubric it may not be showing is a heading that lies. Each story
 * prints its own rubric above its headline.
 */

type SpecTopicBlockProps = {
  /** Investigations first, topped up from the rest of the paper by the caller. */
  articles: ArticleListItem[];
  heading?: string;
  headingId: string;
};

export function SpecTopicBlock({
  articles,
  heading = "Спецтема",
  headingId,
}: SpecTopicBlockProps) {
  if (articles.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="rubric-line mb-1 text-xs font-bold tracking-[0.14em] text-ink uppercase"
      >
        {heading}
      </h2>

      <ul>
        {articles.map((article) => {
          const timestamp = article.publishedAt ?? article.createdAt;
          return (
            <li
              key={article.id}
              className="group border-b border-rule/70 py-3.5 last:border-b-0"
            >
              <Link href={`/news/${article.slug}`} className="block">
                {article.category ? (
                  <RubricLabel
                    name={article.category.name}
                    slug={article.category.slug}
                  />
                ) : null}

                <span className="clamp-3 mt-1 block font-[family-name:var(--font-lora)] text-base leading-snug font-bold tracking-tight text-ink transition-colors group-hover:text-accent group-hover:underline decoration-1 underline-offset-4">
                  {article.title}
                </span>

                <time
                  dateTime={timestamp.toISOString()}
                  className="mt-1 block text-[10px] text-ink-soft"
                >
                  {formatDate(timestamp)}
                </time>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}