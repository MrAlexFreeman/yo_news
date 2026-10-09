"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  categories,
  children,
}: {
  categories: { name: string; slug: string }[];
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

      <CompactHeader categories={categories} compact={compact} />
    </div>
  );
}

/** The id the drawer's panel is wired to, so the button can name what it controls. */
const MENU_PANEL_ID = "compact-sections";

/**
 * The slim bar that takes over once the masthead has scrolled away.
 *
 * **The bar carries no topics.** The previous version put the trending words here, and in
 * practice they ran straight into the wordmark: five one-word topics in a row under a 24px
 * logo reads as one long run of small type with no idea where the name ends and the labels
 * begin. It is a worse bar at every window width, and at 1280px it was strictly worse than
 * showing nothing. The topics are still on the page — the masthead prints them, and the
 * reader has just scrolled past them.
 *
 * What takes their place is the rubric menu, which is not decoration. The pills used to live
 * in the masthead row this bar replaces, so without a menu they would be unreachable while
 * the reader is scrolled — on a phone, where they were already the only route to a rubric.
 * The button is therefore the reason this bar is a working header and not a logo with a
 * search icon next to it.
 */
function CompactHeader({
  categories,
  compact,
}: {
  categories: { name: string; slug: string }[];
  compact: boolean;
}) {
  const pathname = usePathname();

  /*
   * The drawer is remembered together with the route it was opened on, and whether it is
   * open is *derived* rather than stored.
   *
   * Two things have to close it, and both were effects calling `setState` before: navigating
   * away — a reader who taps a rubric lands on a new page with the panel still hanging over
   * the lead headline — and scrolling back to the top, which takes the bar off screen while
   * the panel, anchored at `top-[52px]`, keeps hanging over the masthead. Deriving the
   * answer from the route and from `compact` handles both in the render that already has to
   * happen, with no second pass and no cascading render.
   */
  const [menu, setMenu] = useState({ open: false, at: pathname });
  const menuOpen = menu.open && menu.at === pathname && compact;

  const toggleMenu = () => {
    setMenu(menuOpen ? { open: false, at: pathname } : { open: true, at: pathname });
  };
  const dismiss = () => setMenu({ open: false, at: pathname });

  /* Escape, because a panel that traps the reader until they find the right button is a trap. */
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `dismiss` is stable in effect terms: it only writes the current pathname, which the
    // listener re-reads on every keypress, so omitting it cannot leave a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  return (
    <>
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
        {/*
          Three columns and nothing else: menu, wordmark, controls. The wordmark is centred
          by absolute positioning rather than by `justify-between` with three children,
          because the left and right groups are different widths — «Разделы» is wider than
          the search button — and a centred flex child sits at the centre of the gap between
          them rather than at the centre of the bar.
        */}
        <div className="relative mx-auto flex h-[52px] max-w-7xl items-center px-4">
          <button
            type="button"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls={MENU_PANEL_ID}
            className="flex min-h-9 items-center gap-1.5 rounded-sm px-1.5 text-ink-soft transition-colors hover:bg-paper-dim hover:text-ink"
          >
            <Menu className="size-5" aria-hidden />
            <span className="text-[11px] font-semibold tracking-wide uppercase">
              Разделы
            </span>
          </button>

          <Link
            href="/"
            aria-label="Ё-новости — на главную"
            className="absolute left-1/2 -translate-x-1/2 transition-opacity hover:opacity-70"
          >
            <Logo size="xs" />
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-1">
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

      {/*
        The rubric drawer. Hangs below the bar rather than sliding over it, so the wordmark
        and the controls stay usable while it is open — a reader can close it without
        scrolling back up to the button that opened it.
      */}
      <div
        id={MENU_PANEL_ID}
        inert={menuOpen ? undefined : true}
        hidden={!menuOpen}
        className="fixed inset-x-0 top-[52px] z-50 border-b border-rule bg-paper shadow-md"
      >
        <nav
          aria-label="Разделы"
          className="mx-auto max-w-7xl px-4 py-3"
        >
          <ul className="flex flex-wrap gap-2">
            <li>
              <SectionLink
                href="/"
                label="Все новости"
                onNavigate={dismiss}
              />
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <SectionLink
                  href={`/category/${category.slug}`}
                  label={category.name}
                  onNavigate={dismiss}
                />
              </li>
            ))}
            <li>
              <SectionLink
                href="/forum"
                label="Форум"
                onNavigate={dismiss}
              />
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}

/**
 * One rubric in the drawer.
 *
 * A plain link rather than `NavPill`: that component reads `usePathname` to mark the
 * current section, and there are already two of those on the page whenever the masthead is
 * present. The pills in the drawer are large, full-size targets — this is the one place on
 * a phone where a rubric is tappable, so it should not be the smallest thing on screen.
 */
function SectionLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="inline-flex min-h-10 items-center rounded-full border border-rule bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-yo hover:bg-yo/5 hover:text-yo-ink"
    >
      {label}
    </Link>
  );
}