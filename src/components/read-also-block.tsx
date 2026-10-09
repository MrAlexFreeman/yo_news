import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { readingMinutes } from "@/lib/reading-time";

/**
 * The plate that interrupts a long read with a way further in.
 *
 * A component rather than a string spliced into the body: it keeps the page's own
 * Tailwind classes, its link gets the same hover treatment as every other headline, and
 * the body around it still reaches the browser as two sanitised halves that each render
 * on their own. See `content-loop.ts` for where the cut goes.
 *
 * Rendered on the server. It carries nothing that needs the browser, and the article
 * page is cached as HTML — a client component here would ship JavaScript to re-render a
 * block that was already correct.
 */

/** Structural, not the database row: the tests build these from literals. */
type ReadAlsoStory = {
  slug: string;
  title: string;
  contentHtml: string;
  category: { name: string; slug: string } | null;
};

export function ReadAlsoBlock({ story }: { story: ReadAlsoStory }) {
  return (
    <aside
      aria-labelledby="read-also-heading"
      // `border-rule/80` and the dimmed paper rather than a tinted panel: the block has
      // to read as a line in the article, not as a box dropped into the middle of one.
      className="my-6 border border-rule/80 bg-paper-dim/50 p-4"
    >
      <h2
        id="read-also-heading"
        className="text-xs font-semibold tracking-wider text-accent uppercase"
      >
        Читайте также
      </h2>

      {/*
        The whole block below the kicker is the target, not just the words of the
        headline: on a phone a two-line title at 16px is a 30px-tall link, which is a
        miss. `min-h-11` puts it at 44px with room to spare.
      */}
      <Link
        href={`/news/${story.slug}`}
        className="group mt-2 flex min-h-11 items-start gap-2"
      >
        <span className="clamp-2 text-base leading-snug font-semibold text-ink transition-colors group-hover:text-accent group-hover:underline decoration-1 underline-offset-4">
          {story.title}
        </span>
        <ArrowRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5"
        />
      </Link>

      <p className="mt-1 text-[11px] text-ink-soft">
        {readingMinutes(story.contentHtml)} мин чтения
        {story.category ? ` · ${story.category.name}` : null}
      </p>
    </aside>
  );
}