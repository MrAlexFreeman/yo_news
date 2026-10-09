import Link from "next/link";

import { ArticleShare } from "@/components/article-share";
import { ForumTopicsBlock } from "@/components/forum-topics";
import { NowReading } from "@/components/now-reading";
import { SubscribeBlock } from "@/components/subscribe-block";
import { formatDate, formatTime } from "@/lib/date";
import { getActiveForumTopics } from "@/lib/forum";
import { getPublishedArticles, getTrendingArticles } from "@/lib/public-queries";

/**
 * The column beside a story.
 *
 * Four blocks, in descending order of how likely a reader is to want them: what other
 * readers are on right now, the news they have not read, the conversations happening,
 * and how to follow the paper. The forum block sits above the subscribe plate for the
 * same reason the trending rail leads — a reader who came from a search result is often
 * here to see what else is happening, or to argue about the story, not to subscribe.
 *
 * The whole column is one sticky element from `lg` up; see the note on the wrapper for
 * why "Сейчас читают" carries no pinning of its own.
 *
 * Rendered on the server. Nothing in it needs the browser, and the article page is
 * statically cached, so a client component here would ship JavaScript to re-render a
 * list that was already correct in the HTML.
 */

type ArticleSidebarProps = {
  /** The story being read; excluded from "Главное" so it never links to itself. */
  currentArticleId: string;
  currentTitle: string;
  /** Absolute URL of the story, for the share buttons. */
  currentUrl: string;
};

/** How many rows each list carries. Four is what fits without the block running long. */
const NEWS_COUNT = 4;
const TOPIC_COUNT = 3;
/** The "most read" rail. Five rows fit the sticky column without pushing the share row off. */
const NOW_READING_COUNT = 5;
/** The window "сейчас" means. A day and a night is what a reader calls "now". */
const NOW_READING_HOURS = 48;

export async function ArticleSidebar({
  currentArticleId,
  currentTitle,
  currentUrl,
}: ArticleSidebarProps) {
  // One Promise.all for three lists: three sequential awaits would put the sidebar
  // three round trips deep, and a sidebar that arrives after the article is the one the
  // reader is already past.
  const [latest, topics, trending] = await Promise.all([
    getPublishedArticles(NEWS_COUNT, { excludeId: currentArticleId }),
    getActiveForumTopics(TOPIC_COUNT),
    getTrendingArticles(NOW_READING_COUNT, {
      excludeId: currentArticleId,
      hours: NOW_READING_HOURS,
    }),
  ]);

  return (
    <aside
      aria-label="Материалы и обсуждения"
      className="space-y-6 lg:col-span-4"
    >
      {/*
        Sticky from `lg` only. Below that the sidebar is under the article, where
        sticking it would pin a block the reader has to scroll past to reach anyway.
        `self-start` is what makes the stick work: a grid item is stretched to the
        row height by default, and a stretched element has nothing to stick.
      */}
      <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        {/*
          First in the column: what other readers are on right now is the strongest
          argument for staying, and it is the block that has to be in view before the
          reader reaches the bottom of the article. It inherits the column's pinning
          rather than carrying its own — a second sticky inside a sticky parent is a
          sticky element that never moves relative to it.
        */}
        <NowReading articles={trending} />

        {latest.length > 0 ? (
          <section aria-labelledby="sidebar-latest">
            <h2
              id="sidebar-latest"
              className="border-b border-rule pb-1.5 text-xs font-bold tracking-[0.14em] text-ink uppercase"
            >
              Главное
            </h2>

            <ul className="divide-y divide-rule/70">
              {latest.map((item) => {
                const timestamp = item.publishedAt ?? item.createdAt;
                return (
                  <li key={item.id}>
                    <Link
                      href={`/news/${item.slug}`}
                      className="group flex items-start gap-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="clamp-2 block text-sm leading-snug font-medium text-ink transition-colors group-hover:text-accent-ink">
                          {item.title}
                        </span>
                        <time
                          dateTime={timestamp.toISOString()}
                          className="mt-1 block text-[11px] tabular-nums text-ink-soft"
                        >
                          {formatDate(timestamp)}, {formatTime(timestamp)}
                        </time>
                      </span>

                      {/*
                        A square thumbnail, but only where there is one. Articles
                        without a cover fall back to a lettered placeholder rather
                        than a broken frame, and a row of empty boxes would be worse
                        than no boxes.
                      */}
                      {item.coverImage ? (
                        <span className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element --
                              A fixed 80×80 thumbnail in a list of four does not need
                              the image optimiser; CoverImage is for full-bleed art. */}
                          <img
                            src={item.coverImage}
                            alt=""
                            width={80}
                            height={80}
                            loading="lazy"
                            decoding="async"
                            className="size-20 rounded-sm bg-paper-dim object-cover"
                          />
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/*
          The forum block is hidden when there are no threads, rather than rendered
          with an empty list and a "see all" link to an empty board. On a fresh install
          an empty block reads as broken; on a busy board it is never empty for long.
        */}
        <ForumTopicsBlock
          topics={topics}
          heading="Обсуждения на форуме"
          headingId="sidebar-forum"
        />

        {/*
          The share row lives in the sidebar, beside the story, rather than under it:
          it is a small block and the bottom of a long article is the worst place to
          ask someone to pass it on.
        */}
        <ArticleShare url={currentUrl} title={currentTitle} />

        {/*
          `SubscribeBlock` renders its own heading id. It is used here and at the end
          of the story, so the component derives its id per instance — see
          subscribe-block.tsx. Two blocks with one id would be invalid HTML and would
          break `aria-labelledby` for one of them.
        */}
        <SubscribeBlock variant="card" />
      </div>
    </aside>
  );
}