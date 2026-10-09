import Link from "next/link";

/**
 * The strip between the rubric navigation and the story: what the paper is talking about.
 *
 * Directly under the rubric pills on purpose — it is the same shelf, one level down, and a
 * reader who has just scanned the rubrics is already in the mood to scan topics. A strip
 * that sat above them would have to compete with the navigation for the same row.
 *
 * Horizontally scrollable rather than wrapped. Six words of topic that reflow into two
 * lines on a phone push the first headline below the fold, and the strip's whole value is
 * that it costs nothing: the reader either takes it or scrolls past it.
 *
 * Renders nothing at all when there are no tags. An empty labelled bar across the top of
 * every page is worse than no bar — it advertises that the feature exists and has no data.
 */

type TrendingBarProps = {
  /** Newest topics first. Each carries its own count; see `getTrendingTags`. */
  tags: { name: string; slug: string }[];
  heading?: string;
};

export function TrendingBar({ tags, heading = "В центре внимания" }: TrendingBarProps) {
  if (tags.length === 0) return null;

  return (
    <aside
      aria-label={heading}
      className="border-b border-rule/70 bg-paper-dim/30"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
        <span className="shrink-0 text-xs font-bold tracking-wider text-ink uppercase">
          {heading}
        </span>

        {/*
          The scroll container. `[scrollbar-width:none]` and the WebKit twin hide the
          bar the same way the rubric strip above does — a visible 4px scrollbar under a
          one-line strip reads as a page that has more content than it has room for, which
          is exactly the impression this row is trying not to make.
        */}
        <ul className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tags.map((tag) => (
            <li key={tag.slug} className="shrink-0">
              <Link
                href={`/tags/${tag.slug}`}
                className="text-xs text-ink-soft transition-colors hover:text-accent hover:underline decoration-1 underline-offset-4"
              >
                {tag.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}