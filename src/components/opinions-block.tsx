import Link from "next/link";

import { RubricLabel } from "@/components/article-card";
import { formatRelative } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";
import { SITE_NAME } from "@/lib/site";

/**
 * The opinion column: a name, a round portrait, a headline and when it appeared.
 *
 * There is no author on this site. `Article` carries a rubric, a photo credit and nothing
 * else — a byline would have to be invented, and a column of invented bylines under a
 * news masthead is the kind of thing a later deploy cannot undo.
 *
 * So this is the fallback the design allows: the desk's own byline, a rubric roundel in
 * place of a portrait, and the recent stories readers are spending their time on. The
 * component takes real `ArticleListItem` rows, so when the schema grows an author and a
 * portrait URL the block starts showing people without its markup changing.
 *
 * The roundel is the rubric's first letter in a circle — typographic, not a fake photo. A
 * grey disc with a stock face would be worse than a letter: it would look like a person
 * who does not exist.
 */

type OpinionsBlockProps = {
  articles: ArticleListItem[];
  heading?: string;
  headingId: string;
  /** Frozen so a statically rendered page keeps a stable "2 часа назад". */
  now: Date;
};

/** One circle, one letter. */
function Roundel({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-dim font-[family-name:var(--font-lora)] text-lg font-bold text-ink-soft"
    >
      {letter}
    </span>
  );
}

export function OpinionsBlock({
  articles,
  heading = "Мнения",
  headingId,
  now,
}: OpinionsBlockProps) {
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
          /*
            An exclusive piece is the desk's own reporting, and it is the only thing on
            this site that can honestly be called a column. Anything else is attributed to
            the paper plainly rather than promoted into a byline it was not written under.
          */
          const author = article.isExclusive
            ? "Колонка редактора"
            : `Редакция «${SITE_NAME}»`;

          return (
            <li
              key={article.id}
              className="group border-b border-rule/70 py-3.5 last:border-b-0"
            >
              <Link href={`/news/${article.slug}`} className="flex items-start gap-3">
                <Roundel
                  letter={(article.category?.name ?? SITE_NAME).trim().charAt(0).toUpperCase()}
                />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-ink">{author}</span>
                    <time
                      dateTime={timestamp.toISOString()}
                      className="text-[10px] text-ink-soft"
                    >
                      {formatRelative(timestamp, now)}
                    </time>
                  </span>

                  {article.category ? (
                    <span className="mt-1 block">
                      <RubricLabel
                        name={article.category.name}
                        slug={article.category.slug}
                      />
                    </span>
                  ) : null}

                  <span className="clamp-3 mt-1 block font-[family-name:var(--font-lora)] text-sm leading-snug font-bold tracking-tight text-ink transition-colors group-hover:text-accent group-hover:underline decoration-1 underline-offset-4">
                    {article.title}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}