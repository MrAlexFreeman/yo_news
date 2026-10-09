import Link from "next/link";

import { Badges, RubricLabel } from "@/components/article-card";
import { CoverImage } from "@/components/cover-image";
import { formatDate, formatTime } from "@/lib/date";
import type { ArticleListItem, LoopArticle } from "@/lib/public-queries";
import { readingMinutes } from "@/lib/reading-time";
import { SITE_NAME } from "@/lib/site";

/**
 * The top of the front page: a wide lead column and a narrow "what matters today" column.
 *
 * The asymmetry is the point. Two equal halves would give the lead story a quarter of the
 * measure it needs to carry a headline, and the right column would be a list; a 7/5 split
 * with a rule between them is the shape a broadsheet actually uses — one dominant story,
 * one column of shorter ones, and a hairline that says "these are separate things" rather
 * than a gutter that says "these are a pair".
 *
 * The order inside the lead column is headline first, picture second, metadata last. That
 * is not a preference: a reader scanning the fold sees the rubric and the headline in the
 * first 80 pixels, and only pays for the photograph once the headline has told them what
 * it is about. The previous layout led with the picture and pushed the headline under it.
 *
 * Both columns are server-rendered and collapse to one on a phone — lead, then the urgent
 * column — with no ordering rule needed, because the DOM order is already the reading
 * order on a narrow screen.
 */

type FrontPageHeroProps = {
  /** The lead story. Carries its body, which is what the reading time is computed from. */
  lead: LoopArticle;
  /** The urgent column: the most-read of the last two days, topped up from all time. */
  urgent: ArticleListItem[];
};

/** Square thumbnail beside an urgent headline. */
const URGENT_THUMB = "size-24 sm:size-28";

export function FrontPageHero({ lead, urgent }: FrontPageHeroProps) {
  const timestamp = lead.publishedAt ?? lead.createdAt;
  const href = `/news/${lead.slug}`;

  return (
    <section
      aria-labelledby="front-lead-heading"
      // The double rule is the page edge: everything below it is the columns, not the top.
      className="rule-double pb-7"
    >
      <div className="grid gap-x-10 gap-y-7 lg:grid-cols-12">
        <article className="group lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            {lead.category ? (
              <RubricLabel name={lead.category.name} slug={lead.category.slug} />
            ) : null}
            <Badges article={lead} />
          </div>

          <h1
            id="front-lead-heading"
            className="mt-2 font-[family-name:var(--font-lora)] text-3xl leading-tight font-bold tracking-tight text-ink lg:text-4xl"
          >
            <Link
              href={href}
              className="transition-colors hover:text-accent hover:underline decoration-1 underline-offset-4"
            >
              {lead.title}
            </Link>
          </h1>

          {lead.subtitle || lead.lead ? (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft lg:text-lg">
              {lead.subtitle ?? lead.lead}
            </p>
          ) : null}

          <div className="relative mt-5 aspect-video overflow-hidden rounded-sm bg-paper-dim">
            <CoverImage
              src={lead.coverImage ?? "/placeholder.png"}
              alt={lead.title}
              // This is the page's LCP element: the one image above the fold that decides
              // how fast the front page paints.
              preload
              sizes="(max-width: 1024px) 100vw, 660px"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          </div>

          {/*
            The metadata row the brief asks for: date, reading time, source.

            The source is the publication itself, because there is no per-article outlet to
            name — syndicated material loses its provenance once it becomes an article, and
            printing a wire's name here would credit a text the desk rewrote. It is the
            same line the article page carries, so a reader who lands on either end of the
            site reads the same three facts.
          */}
          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-soft">
            <time dateTime={timestamp.toISOString()}>
              {formatDate(timestamp)}, {formatTime(timestamp)}
            </time>
            <span aria-hidden>·</span>
            <span>{readingMinutes(lead.contentHtml)} мин чтения</span>
            <span aria-hidden>·</span>
            <span>{SITE_NAME}</span>
          </p>
        </article>

        {urgent.length > 0 ? (
          <section
            aria-labelledby="front-urgent-heading"
            className="lg:col-span-5 lg:border-l lg:border-rule/70 lg:pl-10"
          >
            <h2
              id="front-urgent-heading"
              className="rubric-line mb-1 text-xs font-bold tracking-[0.14em] text-ink uppercase"
            >
              Важное за сегодня
            </h2>

            <ul>
              {urgent.map((article) => (
                <li
                  key={article.id}
                  className="group border-b border-rule/70 py-4 last:border-b-0 last:pb-0"
                >
                  <Link href={`/news/${article.slug}`} className="flex items-start gap-4">
                    <span className="min-w-0 flex-1">
                      {article.category ? (
                        <RubricLabel
                          name={article.category.name}
                          slug={article.category.slug}
                        />
                      ) : null}

                      <span
                        className="clamp-3 mt-1 block font-[family-name:var(--font-lora)] text-base leading-snug font-bold tracking-tight text-ink transition-colors group-hover:text-accent group-hover:underline decoration-1 underline-offset-4"
                      >
                        {article.title}
                      </span>

                      <time
                        dateTime={(article.publishedAt ?? article.createdAt).toISOString()}
                        className="mt-1 block text-[10px] text-ink-soft"
                      >
                        {formatDate(article.publishedAt ?? article.createdAt)}
                      </time>
                    </span>

                    {/*
                      `self-start` on a flex row is load-bearing, not decoration: without it
                      the thumbnail is stretched to the height of the text beside it, which
                      quietly breaks the square the box asks for.
                    */}
                    <span
                      className={`relative ${URGENT_THUMB} shrink-0 self-start overflow-hidden bg-paper-dim`}
                    >
                      <CoverImage
                        src={article.coverImage ?? "/placeholder.png"}
                        alt=""
                        sizes="112px"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}