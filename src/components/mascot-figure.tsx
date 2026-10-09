"use client";

import { useEffect, useState } from "react";

import { Mascot } from "page-mascot";

/**
 * The cat itself, behind a load probe.
 *
 * Why the probe is here at all: `Mascot` paints its two sprite sheets as CSS
 * `background-image` on a transparent button. When a sheet is missing the browser logs a
 * 404 and renders nothing — which leaves an invisible, focusable, clickable button sitting
 * in the corner of every page. That is worse than having no mascot at all: a keyboard user
 * tabs onto something they cannot see and a screen reader announces a button that does not
 * draw.
 *
 * The probe costs nothing in practice. `new Image()` for a URL the page is about to request
 * as a background hits the HTTP cache, so the bytes are fetched once and this is a cache
 * hit rather than a second download.
 *
 * `pending` is the initial state and not `false`, so there is no render in which the
 * button exists and the sheets do not.
 */
export function MascotFigure({
  directions,
  reactions,
  size,
  label,
  className,
}: {
  directions: string;
  reactions: string;
  size: number;
  label: string;
  /**
   * Applied to the library's button. Needed because `MascotWidget` puts the widget in
   * `pointer-events-none` so its empty box does not swallow clicks, and `pointer-events`
   * is inherited: without `pointer-events-auto` here the cat would inherit `none` from the
   * wrapper and stop responding to the very poke it exists for.
   */
  className?: string;
}) {
  const [state, setState] = useState<"pending" | "ready" | "missing">("pending");

  useEffect(() => {
    let cancelled = false;

    // Only one sheet has to answer: both are built together and are either both present
    // or both absent, and the directions sheet is the one that must exist for the idle
    // state to draw anything at all.
    const probe = new Image();

    probe.onload = () => {
      if (!cancelled) setState("ready");
    };
    probe.onerror = () => {
      if (!cancelled) setState("missing");
    };
    probe.src = directions;

    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [directions]);

  // Nothing on failure: the widget is a garnish, and a garnish that cannot load owes the
  // reader no error message and no empty box.
  if (state !== "ready") return null;

  return (
    <Mascot
      directions={directions}
      reactions={reactions}
      size={size}
      label={label}
      className={className}
    />
  );
}