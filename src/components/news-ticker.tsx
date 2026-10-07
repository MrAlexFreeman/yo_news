import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { RubricLabel } from "@/components/article-card";
import { formatTime, groupByDay, plural } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";

type NewsTickerProps = {
  articles: ArticleListItem[];
  /** Injected so a statically rendered page keeps a stable "now". */
  now: Date;
};

/**
 * "Картина дня": the chronological rail beside the hero. Time badges on the left,
 * headline and rubric on the right — a classic ticker column.
 *
 * Not sticky, and that is a fix rather than a missing feature. It used to carry
 * `lg:sticky lg:top-4`, and a sticky element keeps its slot in the flow while painting
 * over whatever scrolls past it — so the subscribe block below slid up across the
 * pinned headlines, and a list taller than the viewport had its lower rows permanently
 * unreachable, because the rail never released the top of the screen to reveal them.
 *
 * `self-start` was inert here regardless: the parent is a plain block, not a grid, so
 * it was never doing anything.
 */
export function NewsTicker({ articles, now }: NewsTickerProps) {
  const groups = groupByDay(
    articles,
    (article) => article.publishedAt ?? article.createdAt,
    now,
  );

  return (
    <section aria-labelledby="news-ticker-heading">
      <h2
        id="news-ticker-heading"
        className="flex items-center gap-2 border-b-2 border-ink pb-1.5 text-xs font-bold tracking-[0.14em] text-ink uppercase"
      >
        <span className="size-2 rounded-full bg-accent" aria-hidden />
        Лента новостей
      </h2>

      {articles.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">
          Пока нет опубликованных новостей.
        </p>
      ) : (
        /*
          One list, not one per day, so a screen reader reads the feed as a single
          thing. The day headings live inside it, which keeps the item count honest.
        */
        <ol>
          {groups.map((group) => (
            <li key={group.key}>
              {/*
                The day divider. Its whole job is to say which day the clock times below
                belong to: the times on their own read as scrambled the moment the feed
                crosses midnight, which is what made this look like a sorting fault.
              */}
              <h3 className="mt-3 mb-1 border-b border-rule pb-1 text-[11px] font-semibold tracking-[0.08em] text-ink-soft uppercase first:mt-0">
                {group.label}
              </h3>

              <ol>
                {group.items.map((article) => {
                  const timestamp = article.publishedAt ?? article.createdAt;
                  const ageHours = Math.max(
                    0,
                    Math.floor(
                      (now.getTime() - timestamp.getTime()) / (60 * 60 * 1000),
                    ),
                  );

                  return (
                    <li
                      key={article.id}
                      className="border-b border-rule/70 py-2.5 last:border-b-0"
                    >
                      <div className="flex gap-3">
                        <time
                          dateTime={timestamp.toISOString()}
                          title={
                            ageHours > 0
                              ? `${ageHours} ${plural(ageHours, "час", "часа", "часов")} назад`
                              : "только что"
                          }
                          className="shrink-0 pt-px font-mono text-xs font-semibold text-accent tabular-nums"
                        >
                          {formatTime(timestamp)}
                        </time>

                        <div className="min-w-0">
                          <h4 className="clamp-2 text-sm leading-snug font-medium text-ink">
                            <Link
                              href={`/news/${article.slug}`}
                              className="transition-colors hover:text-accent"
                            >
                              {article.title}
                            </Link>
                          </h4>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {article.category ? (
                              <RubricLabel
                                name={article.category.name}
                                slug={article.category.slug}
                                className="text-ink-soft"
                              />
                            ) : null}
                            {article.isExclusive ? (
                              <span className="text-[9px] font-bold tracking-wide text-accent uppercase">
                                Эксклюзив
                              </span>
                            ) : null}
                            {article.is18plus ? (
                              <span className="text-[9px] font-bold tracking-wide text-ink-soft uppercase">
                                18+
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {/*
        The rail is deliberately short — it is a summary beside the hero, not the
        archive — so it has to say where the rest of the list is, or a reader has no
        way past the eight stories they can see. The link lives inside the section it
        belongs to rather than in the page, so it cannot be dropped from the column
        without also dropping the list.
      */}
      <Link
        href="/news"
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline"
      >
        Вся лента новостей
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </section>
  );
}
