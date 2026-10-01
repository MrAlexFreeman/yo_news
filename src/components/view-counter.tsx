"use client";

import { useEffect, useRef } from "react";

import { plural } from "@/lib/date";

type ViewCounterProps = {
  articleId: string;
  /** Rendered value; the server-cached count updates once the client is alive. */
  initialViews: number;
};

/**
 * Increments the view counter once per article open.
 *
 * Deliberately a client effect rather than a render-time write: the article page
 * is statically cached with ISR, so counting during render would hit the
 * database on every request and permanently invalidate that cache.
 *
 * sessionStorage guards against the React development double-effect, which would
 * otherwise inflate the count on every hot reload.
 */
export function ViewCounter({ articleId, initialViews }: ViewCounterProps) {
  const counted = useRef(false);

  useEffect(() => {
    if (counted.current) return;
    counted.current = true;

    const key = `viewed:${articleId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private mode can throw on sessionStorage; counting twice is acceptable.
    }

    void fetch(`/api/articles/${articleId}/view`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // A failed counter write must never surface to the reader.
    });
  }, [articleId]);

  return (
    <span suppressHydrationWarning>
      {initialViews}{" "}
      {plural(initialViews, "просмотр", "просмотра", "просмотров")}
    </span>
  );
}
