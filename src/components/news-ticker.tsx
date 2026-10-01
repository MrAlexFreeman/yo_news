import Link from "next/link";

import { RubricLabel } from "@/components/article-card";
import { formatTime, plural } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";

type NewsTickerProps = {
  articles: ArticleListItem[];
  /** Injected so a statically rendered page keeps a stable "now". */
  now: Date;
};

/**
 * "Картина дня": the chronological rail beside the hero. Time badges on the
 * left, headline and rubric on the right — a classic ticker column.
 */
export function NewsTicker({ articles, now }: NewsTickerProps) {
  return (
    <section aria-labelledby="news-ticker-heading" className="lg:sticky lg:top-4 lg:self-start">
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
        <ol>
          {articles.map((article) => {
            const timestamp = article.publishedAt ?? article.createdAt;
            const ageHours = Math.max(
              0,
              Math.floor((now.getTime() - timestamp.getTime()) / (60 * 60 * 1000)),
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
                    <h3 className="clamp-2 text-sm leading-snug font-medium text-ink">
                      <Link
                        href={`/news/${article.slug}`}
                        className="transition-colors hover:text-accent"
                      >
                        {article.title}
                      </Link>
                    </h3>
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
      )}
    </section>
  );
}
