"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/logo";

/**
 * Scroll depth at which the masthead gives way to the compact bar.
 *
 * Measured from the document, not from the masthead: the reader has to get past the
 * wordmark and the rubric row before a slim bar takes over, and 120px is what that
 * actually feels like on a laptop.
 */
const COMPACT_AFTER_PX = 120;

/**
 * Two-phase header: the full masthead at rest, a 52px bar once the reader scrolls.
 *
 * **Why the compact bar is `fixed` and not `sticky`.** The brief asks for `sticky top-0`
 * and also asks that nothing below the header jump. Those two cannot both hold: a sticky
 * element keeps its place in the flow, so a bar that grows from 0 to 52px *moves the whole
 * document down by 52px* the moment it appears. Reserving the height the other way — 52px
 * of permanent gap under the compact bar — costs the reader a strip of screen on every
 * scrolled page, which is the opposite of what a compact bar is for. `fixed` takes the bar
 * out of the flow entirely: the masthead scrolls away under it as it does on the sites
 * this imitates, and the content below never moves by a single pixel. The trade is that
 * the bar covers the top 52px while scrolling, which is the behaviour every newspaper
 * front page ships and the reason it reads as "the site is still there".
 *
 * **Why an IntersectionObserver and not a scroll listener.** A scroll handler runs on every
 * frame of every scroll on every page, and the only thing it would do is compare a number
 * against 120. The marker below is observed instead, so the work happens twice per scroll —
 * once crossing the threshold down, once crossing back up — and not at all in between.
 *
 * **Height stability.** The compact bar is a fixed-height row (`h-[52px]`) whose contents
 * never reflow when it appears: the logo has a fixed size, the strip scrolls horizontally
 * inside its own box. The bar appearing is therefore the only visual change on the page,
 * and the test suite asserts the height is constant.
 */
export function HeaderShell({
  trendingTags,
  children,
}: {
  trendingTags: { name: string; slug: string }[];
  children: React.ReactNode;
}) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    /*
     * The marker sits at exactly COMPACT_AFTER_PX in the document and is one pixel tall,
     * so it stops intersecting the viewport the moment the reader passes that depth. No
     * rootMargin: shrinking the root by the same distance would make the marker clear it
     * 120px early, and the number in the constant is the number that fires.
     *
     * This also gets the mid-page load right for free. On a page restored at scroll depth
     * — a shared link to an anchor, a back-navigation — the observer reports the marker's
     * real position on its first callback, so the compact bar is correct immediately
     * instead of flashing the full masthead and then collapsing.
     */
    const observer = new IntersectionObserver(
      ([entry]) => setCompact(!entry.isIntersecting),
      { threshold: 0 },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  return (
    /*
     * `relative` so the marker can be placed against the top of the document. It creates
     * no stacking or containing block for the compact bar, which must stay fixed to the
     * viewport.
     */
    <div className="relative">
      <div
        ref={markerRef}
        aria-hidden
        className="pointer-events-none absolute left-0 w-px"
        style={{ top: COMPACT_AFTER_PX, height: 1 }}
      />

      {/*
        The masthead. `inert` while the compact bar is up takes it out of the tab order
        and the accessibility tree: it is scrolled off the top of the screen but still in
        the document, so without this a keyboard user tabs into links and a screen reader
        reads a navigation that is nowhere near the viewport.
      */}
      <div inert={compact ? true : undefined}>{children}</div>

      <CompactHeader trendingTags={trendingTags} compact={compact} />
    </div>
  );
}

/**
 * The slim bar that takes over once the masthead has scrolled away.
 *
 * The rubric pills are replaced by the topic strip rather than kept: nine pills cannot fit
 * in 52px beside a logo, and shrinking them to the point of fitting produces targets too
 * small to hit. The forum and every rubric stay reachable from the footer, which lists
 * them all — this bar is a shortcut back into the page, not the site's navigation.
 */
function CompactHeader({
  trendingTags,
  compact,
}: {
  trendingTags: { name: string; slug: string }[];
  compact: boolean;
}) {
  return (
    <div
      /*
        `inert` rather than `hidden`: `hidden` would remove the bar from the layout the
        instant compact turns off and skip the slide-down entirely. Inert keeps it in the
        document, keeps it unfocusable, and lets the transition run.
      */
      inert={compact ? undefined : true}
      className={[
        "fixed inset-x-0 top-0 z-50",
        "border-b border-rule bg-paper/95 shadow-sm backdrop-blur-sm",
        // No horizontal padding here: the row inside carries the page gutter, so the bar
        // spans the full width while its contents stay on the 7xl grid.
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        compact ? "translate-y-0" : "-translate-y-full",
      ].join(" ")}
    >
      <div className="mx-auto flex h-[52px] max-w-7xl items-center gap-3 px-4">
        {/*
          The compact wordmark. `size="xs"` is the 24px lockup, matching the `h-6` the
          design asks for; the masthead above still uses `lg`.
        */}
        <Link
          href="/"
          aria-label="Ё-новости — на главную"
          className="shrink-0 transition-opacity hover:opacity-70"
        >
          <Logo size="xs" />
        </Link>

        {/*
          The topic strip, standing in for the rubric pills. `min-w-0` is what lets a flex
          child shrink below its content width, and without it the strip would push the
          controls off the right edge instead of scrolling.
        */}
        {trendingTags.length > 0 ? (
          <nav
            aria-label="В центре внимания"
            className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <ul className="flex items-center gap-4 whitespace-nowrap">
              {trendingTags.map((tag) => (
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
          </nav>
        ) : (
          /*
            The spacer, and it matters. With no topics the strip disappears, the logo would
            sit against the controls with nothing between them, and the two ends of the bar
            would drift together as the window narrowed. An empty flex child keeps the
            logo pinned to the left and the controls to the right at every width.
          */
          <div className="flex-1" />
        )}

        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-1.5 text-[10px] font-semibold tracking-wide text-live-ink uppercase sm:inline-flex">
            <span className="live-dot size-1.5 rounded-full bg-live" aria-hidden />
            Прямой эфир
          </span>

          <Link
            href="/search"
            aria-label="Поиск"
            title="Поиск"
            className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-paper-dim hover:text-ink"
          >
            <Search className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}