"use client";

import dynamic from "next/dynamic";

/**
 * The editorial cat, in the corner of every public page.
 *
 * Two decisions worth stating, because both differ from the obvious one.
 *
 * **It lives in the `(public)` layout, not the root layout.** The root layout wraps `/admin`
 * too, and a cat that tracks your cursor while you are trying to edit an article is not
 * charm, it is a target that moves. The public group is where a mascot belongs; the CMS
 * gets a working surface.
 *
 * **The sheets are checked before the button exists.** See `MascotFigure` — a missing sprite
 * would otherwise leave an invisible focusable button in the corner of the site, which is a
 * worse outcome than no cat.
 *
 * The mascot is loaded with `ssr: false` and through `next/dynamic`. Two reasons, and the
 * second is the real one. The library reads `window.matchMedia` in an effect and paints
 * sprite sheets, so there is nothing for a server render to produce; and a decorative
 * element has no business in the server payload or in the critical path of every page. The
 * cat arrives after hydration, which is exactly when it becomes useful.
 */
const MascotFigure = dynamic(
  () => import("@/components/mascot-figure").then((mod) => mod.MascotFigure),
  // Nothing to show while it loads. Rendering a placeholder box here would put a hole in
  // the corner of every page for the fraction of a second the chunk takes to arrive.
  { ssr: false },
);

/**
 * Edge length in CSS pixels. 76 rather than the library's 140 default: at 140 the cat is
 * taller than the sticky footer bar and sits over the corner of the last card on a laptop,
 * which is the one place a reader's eye is already going. Three 3x3 sheets at 1080px each
 * still downsample cleanly at this size.
 */
const MASCOT_SIZE = 76;

/**
 * The name. It reaches a screen reader through the library's own button, whose template is
 * fixed English — `Boop the ${label}` — so the noun is Russian and the verb is not. The
 * component takes no way to replace that string, and forking a 6 kB dependency to change
 * one template string is not worth it. See the note in the deploy report.
 */
const MASCOT_LABEL = "редакционный кот Ёжик";

/** The tooltip. Hidden from assistive tech: the button already carries the same name. */
const MASCOT_TOOLTIP = "Редакционный кот Ёжик";

export function MascotWidget() {
  return (
    /*
      `pointer-events-none` on the box, `pointer-events-auto` on the cat itself. The task
      asked for `pointer-events-auto` on the container, which sounds safer but is not: the
      container is the full `bottom-4 right-4` box, and a transparent 76px square sitting
      over the page corner swallows clicks aimed at whatever is underneath it. Only the cat
      should be clickable; the padding around it belongs to the article.
    */
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-30 hidden md:block"
      /* Reserve the corner even before the chunk arrives, so the cat's arrival never shifts
         anything. Height and width are set here rather than on the cat so the layout is
         identical in both states. */
      style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}
    >
      {/*
        `group` on the wrapper and `group-hover` on the tooltip: the hover has to start on
        the cat, not on the box, otherwise the label appears as the pointer passes through
        empty space on the way in.
      */}
      <div className="group relative">
        <MascotFigure
          directions="/mascots/cat-directions.webp"
          reactions="/mascots/cat-reactions.webp"
          size={MASCOT_SIZE}
          label={MASCOT_LABEL}
          className="pointer-events-auto"
        />

        {/* Sits above the cat, right-aligned so it cannot run off a narrow viewport. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 bottom-full mb-2 hidden whitespace-nowrap rounded-sm border border-rule bg-paper px-2 py-1 text-[11px] text-ink-soft shadow-sm opacity-0 transition-opacity group-hover:opacity-100 lg:block"
        >
          {MASCOT_TOOLTIP}
        </span>
      </div>
    </div>
  );
}