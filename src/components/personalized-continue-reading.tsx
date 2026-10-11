"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { ContinueReading } from "@/components/continue-reading";
import type { LoopCardStory } from "@/components/loop-card";
import { pickUnseen, readViewed, rememberViewed, VIEWED_STORAGE_KEY } from "@/lib/viewed-articles";

/**
 * The closing grid, ordered for the reader who is looking at it.
 *
 * The server sends a pool longer than the grid and this component chooses from it, because the
 * choice depends on what this browser has already opened — which the server cannot know. The
 * article pages are cached HTML shared by every reader, so there is no per-reader render to
 * make the decision in, and the alternatives are worse than a little JavaScript: a cookie would
 * mean tracking a reader around a news site and asking them to consent to it.
 *
 * **The list is read with `useSyncExternalStore`, not with an effect and a state hook.** The
 * two are not equivalent here. An effect that calls `setState` renders the grid twice for every
 * reader and is a cascading render by construction; a store snapshot is read once, during
 * render, and the hook is built for exactly this — a value that lives outside React and differs
 * between the server and the browser. `getServerSnapshot` answers the empty list, so the HTML
 * the server produced is what hydrates, and the reader's own order replaces it immediately
 * afterwards with no flash of a different grid.
 *
 * The card props are already reduced on the server (see `LoopCardStory`): what crosses to the
 * browser is eight headlines and their metadata, not eight article bodies.
 */

/** Stable reference for the server pass: the hook compares snapshots by identity. */
const NO_HISTORY: readonly string[] = [];

/** Another tab opening a story changes the list; `storage` fires for this tab's siblings. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function PersonalizedContinueReading({
  currentSlug,
  popular,
  highlights,
  rowSize,
}: {
  /** The story being read: recorded as viewed, and already excluded from the pool. */
  currentSlug: string;
  popular: LoopCardStory[];
  highlights: LoopCardStory[];
  /** How many cards one row shows. */
  rowSize: number;
}) {
  /*
    Parsed once per distinct stored string.

    `useSyncExternalStore` requires the same reference until the data actually changes — a
    fresh array on every call is an infinite render loop — so the parse is cached against the
    raw value it came from.
  */
  const cache = useRef<{ raw: string | null; list: readonly string[] } | null>(null);

  const getSnapshot = useCallback(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(VIEWED_STORAGE_KEY);
    } catch {
      // Storage can be refused outright. No history is a working answer.
      raw = null;
    }

    if (!cache.current || cache.current.raw !== raw) {
      cache.current = { raw, list: readViewed(window.localStorage) };
    }
    return cache.current.list;
  }, []);

  const viewed = useSyncExternalStore(subscribe, getSnapshot, () => NO_HISTORY);

  /*
    Recording the visit is a write, not an input to this render.

    The story being read is already excluded from the pool by the page, so nothing on screen
    changes because of this — which is why it can live in an effect without a state update,
    and why the grid does not need to re-render when it happens.
  */
  useEffect(() => {
    try {
      rememberViewed(window.localStorage, currentSlug);
    } catch {
      // Storage unavailable: the grid still works, the history simply does not grow.
    }
  }, [currentSlug]);

  const take = (pool: LoopCardStory[]) => pickUnseen(pool, viewed, rowSize);

  return <ContinueReading popular={take(popular)} highlights={take(highlights)} />;
}
