import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";

import { formatDate } from "@/lib/date";
import type { ActiveForumTopic } from "@/lib/forum";
import { cn } from "@/lib/utils";

/**
 * "Обсуждают на форуме": the threads with the most recent activity.
 *
 * Shown in two places — the column beside a story and the homepage's right rail — so
 * it lives here rather than in either. Two copies of this markup would drift the
 * moment the badge or the link shape changed, and the homepage copy is the one nobody
 * would remember to update.
 *
 * Presentational on purpose: it takes rows instead of fetching them, so a caller that
 * already awaits something else can run both queries in one `Promise.all` instead of
 * serialising two round trips.
 */

type ForumTopicsBlockProps = {
  topics: ActiveForumTopic[];
  /** Rendered as the block's h2. The two call sites word it differently. */
  heading: string;
  /**
   * Unique per instance, and the caller supplies it.
   *
   * `SubscribeBlock` derives this with `useId` because it is a client component. This
   * one is not, and a fixed id would be a duplicate the moment both blocks appear on
   * one document — invalid HTML, and it silently breaks the `aria-labelledby` aimed at
   * whichever one the parser resolved second.
   */
  headingId: string;
  /**
   * Whether the heading carries the newspaper's heavy rule and an amber dot.
   *
   * The two call sites sit in different visual systems: the homepage rail marks each
   * of its blocks with that heavy rule, while the article sidebar marks its blocks
   * with a thin one. Matching the neighbours is what makes the block look native in
   * both, so this is a choice about context, not about the component.
   */
  accented?: boolean;
};

export function ForumTopicsBlock({
  topics,
  heading,
  headingId,
  accented = false,
}: ForumTopicsBlockProps) {
  /*
    Hidden when there are no threads, rather than rendered with an empty list and a
    "see all" link to an empty board. On a fresh install an empty block reads as broken;
    on a busy board it is never empty for long.
  */
  if (topics.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className={cn(
          "pb-1.5 text-xs font-bold tracking-[0.14em] text-ink uppercase",
          accented
            ? "flex items-center gap-2 border-b-2 border-ink"
            : "border-b border-rule",
        )}
      >
        {accented ? (
          <span className="size-2 rounded-full bg-yo-dot" aria-hidden />
        ) : null}
        {heading}
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
  );
}
