import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";

import { ArticleShare } from "@/components/article-share";
import { SubscribeBlock } from "@/components/subscribe-block";
import { formatDate, formatTime } from "@/lib/date";
import { getActiveForumTopics } from "@/lib/forum";
import { getPublishedArticles } from "@/lib/public-queries";

/**
 * The column beside a story.
 *
 * Three blocks, in descending order of how likely a reader is to want them: the news
 * they have not read, the conversations happening now, and how to follow the paper.
 * The forum block sits above the subscribe plate for the same reason — a reader who
 * came from a search result is often here to argue about the story, not to subscribe.
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

export async function ArticleSidebar({
  currentArticleId,
  currentTitle,
  currentUrl,
}: ArticleSidebarProps) {
  const [latest, topics] = await Promise.all([
    getPublishedArticles(NEWS_COUNT, { excludeId: currentArticleId }),
    getActiveForumTopics(TOPIC_COUNT),
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
        {topics.length > 0 ? (
          <section aria-labelledby="sidebar-forum">
            <h2
              id="sidebar-forum"
              className="border-b border-rule pb-1.5 text-xs font-bold tracking-[0.14em] text-ink uppercase"
            >
              Обсуждения на форуме
            </h2>

            <ul className="divide-y divide-rule/70">
              {topics.map((topic) => (
                <li key={topic.id}>
                  <Link
                    href={`/forum/${topic.categorySlug}/${topic.slug}`}
                    className="group flex items-start justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="clamp-2 block text-sm leading-snug text-ink transition-colors group-hover:text-accent-ink">
                        {topic.title}
                      </span>
                      <time
                        dateTime={topic.updatedAt.toISOString()}
                        className="mt-1 block text-[11px] tabular-nums text-ink-soft"
                      >
                        {formatDate(topic.updatedAt)}
                      </time>
                    </span>

                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-dim px-1.5 py-0.5 text-[11px] tabular-nums text-ink-soft">
                      <MessageSquare className="size-3" aria-hidden />
                      {topic.replies}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <Link
              href="/forum"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline"
            >
              Все темы форума
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </section>
        ) : null}

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