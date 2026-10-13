import Link from "next/link";

import { formatRelative } from "@/lib/date";
import type { ArticleListItem } from "@/lib/public-queries";
import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

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

/*
  Мягкая палитра монограмм — оттенки бренда, а не случайные цвета.

  Раньше все три круга были одинаково серыми, и колонка из «О», «Р», «Э» читалась штампом.
  Тон берётся из рубрики материала: детерминированный хеш слага → индекс, поэтому одна рубрика
  всегда одного цвета, и он переживает перестановку карточек. Это не фотографии авторов, которых
  редакция сознательно избегает, — просто цвет, чтобы колонка дышала.
*/
const ROUNDEL_TONES = [
  "border-yo/25 bg-yo/10 text-yo-ink",
  "border-accent/25 bg-accent/10 text-accent-ink",
  "border-yo-dot/30 bg-yo-dot/15 text-yo-ink",
  "border-ink/15 bg-ink/5 text-ink-soft",
] as const;

/** Детерминированный тон рубрики: один слага — один цвет, всегда. */
function toneFor(slug: string): string {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return ROUNDEL_TONES[hash % ROUNDEL_TONES.length];
}

/** One circle, one letter, tinted by the story's rubric. */
function Roundel({ letter, tone }: { letter: string; tone: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full border font-[family-name:var(--font-lora)] text-lg font-bold",
        tone,
      )}
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
                  tone={toneFor(article.category?.slug ?? SITE_NAME)}
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