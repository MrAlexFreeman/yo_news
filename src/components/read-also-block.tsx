import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { readingMinutes } from "@/lib/reading-time";
import { READ_ALSO_KICKER } from "@/lib/read-also";

/**
 * The plate that interrupts a long read with a way further in.
 *
 * A component rather than a string spliced into the body: it keeps the page's own
 * Tailwind classes, its link gets the same hover treatment as every other headline, and the
 * body around it still reaches the browser as two sanitised halves that each render
 * on their own. See `content-loop.ts` for where the cut goes.
 *
 * Rendered on the server. It carries nothing that needs the browser, and the article
 * page is cached as HTML — a client component here would ship JavaScript to re-render a
 * block that was already correct.
 *
 * The same component renders both the automatic plate and one an editor inserted by hand
 * (see `lib/read-also.ts`), which is the reason a story that changed its cover shows the
 * new photograph in a plate placed months ago.
 */

/** Structural, not the database row: the tests build these from literals. */
type ReadAlsoStory = {
  slug: string;
  title: string;
  contentHtml: string;
  /**
   * The story's photograph, if it has one.
   *
   * Optional in the type rather than assumed: most syndicated material arrives without a
   * cover, and a plate that reserved space for a photograph would print an empty grey
   * rectangle — which reads as a broken image rather than as a story with no picture.
   */
  coverImage?: string | null;
  category: { name: string; slug: string } | null;
};

/**
 * The width of the thumbnail, as a Tailwind class.
 *
 * 120px rather than 140: the plate is a single line of the article's measure, and at 140px
 * a phone's 360px screen gives the headline about half the row. At 120 the headline still
 * reads as a headline, and the photograph is still unmistakably a photograph.
 */
export function ReadAlsoBlock({ story }: { story: ReadAlsoStory }) {
  const cover = story.coverImage?.trim() ?? "";
  const minutes = readingMinutes(story.contentHtml);

  return (
    <aside
      // Named by the kicker text rather than by `aria-labelledby` pointing at an id: a
      // page can now carry two plates — the automatic one and one an editor placed by hand
      // — and two elements answering to `read-also-heading` would leave the second one
      // referring to the first.
      aria-label={READ_ALSO_KICKER}
      // `border-rule/80` and the dimmed paper rather than a tinted panel: the block has
      // to read as a line in the article, not as a box dropped into the middle of one.
      className="my-6 border border-rule/80 bg-paper-dim/50 p-4"
    >
      {/*
        Side by side once there is something to put beside the words. Without a cover the
        block is one column, because a row whose only content is the empty half is a layout
        that explains nothing.
      */}
      <div className={cover ? "flex items-start gap-3 sm:gap-4" : undefined}>
        {cover ? (
          /*
            `object-cover` on a fixed box: covers arrive from Unsplash at 16:9, from a phone
            at 4:3, and from an old wire story at whatever the agency sent. Without the crop
            a portrait phone shot stretches the block to a third of a screen.

            80px on a phone and 120px from `sm` up, rather than hidden on the small screen.
            Dropping the picture entirely there would have been the easy way to stop it
            crowding the headline, but the photograph is the reason the plate reads as a
            link to a story rather than as another headline — and at 80px it costs the
            headline about a fifth of a 360px row.

            `loading="lazy"` because the plate sits in the middle of a story the reader has
            already started, and this picture is not what they came for.

            `width`/`height` describe the large box, and `aspect-square` on the element
            overrides it on the small screen. The attributes exist so the browser can
            reserve space before the bytes arrive; the class decides the reserved shape.
          */
          // A plain <img> rather than next/image: this is a fixed 80-120px thumbnail of
          // a file already on this server, and CoverImage is for full-bleed art. Line
          // comments, not a JSX one, because this sits inside a ternary expression and
          // a {/* ... */} in that position is what the parser choked on.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            width={120}
            height={120}
            className="aspect-square size-20 shrink-0 rounded object-cover sm:size-[120px]"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold tracking-wider text-accent uppercase">
            {READ_ALSO_KICKER}
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
            {minutes} мин чтения
            {story.category ? ` · ${story.category.name}` : null}
          </p>
        </div>
      </div>
    </aside>
  );
}