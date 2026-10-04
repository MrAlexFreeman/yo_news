"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import type { MediaItem } from "@/lib/article-media";
import { cn } from "@/lib/utils";

type ArticleGalleryProps = {
  items: MediaItem[];
  alt?: string;
};

/**
 * Story gallery with a click-to-enlarge lightbox.
 *
 * Client component because the lightbox is the only part that needs state; the
 * grid itself is plain markup and next/image, so the thumbnails stay lazy and
 * optimised exactly like every other image on the site.
 *
 * Two columns on narrow screens and three from `lg` up, which is what the layout
 * calls for. A single item renders full width instead of a lonely thumbnail in a
 * two-column grid.
 */
export function ArticleGallery({ items, alt = "" }: ArticleGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current === null) return current;
        return (current + delta + items.length) % items.length;
      });
    },
    [items.length],
  );

  // Escape closes, arrows move. Bound to the dialog only, and only while it is
  // open, so a gallery on a long article does not swallow the reader's keys.
  useEffect(() => {
    if (openIndex === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  if (items.length === 0) return null;

  const active = openIndex === null ? null : items[openIndex];

  return (
    <>
      <ul
        className={cn(
          "mt-6 grid gap-3",
          items.length === 1 ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3",
        )}
      >
        {items.map((item, index) => (
          <li key={item.url}>
            <figure className="h-full">
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={`Открыть изображение ${index + 1} из ${items.length}`}
                className="group block w-full cursor-zoom-in overflow-hidden rounded-sm border border-rule bg-paper-dim"
              >
                <Image
                  src={item.url}
                  alt={item.caption || alt}
                  width={item.width || 1200}
                  height={item.height || 800}
                  // The grid is below the fold on every page that carries it, so
                  // nothing here is preloaded.
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </button>

              {item.caption || item.source ? (
                <figcaption className="mt-1.5 text-[11px] text-ink-soft">
                  {item.caption}
                  {item.caption && item.source ? (
                    <span aria-hidden> · </span>
                  ) : null}
                  {item.source ? <span className="italic">{item.source}</span> : null}
                </figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          // Clicking the backdrop closes; clicking the image must not, so the
          // reader can pan a large photo without dismissing it by accident.
          onClick={close}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/95 p-4"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="absolute top-3 right-3 rounded-full p-2 text-paper/80 transition-colors hover:bg-white/10 hover:text-paper"
          >
            <X className="size-6" aria-hidden />
          </button>

          <figure
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-full flex-col items-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.url}
              alt={active.caption || alt}
              className="max-h-[80vh] w-auto max-w-full object-contain"
            />
            {active.caption || active.source ? (
              <figcaption className="mt-3 max-w-2xl text-center text-xs text-paper/80">
                {active.caption}
                {active.caption && active.source ? <span aria-hidden> · </span> : null}
                {active.source ? <span className="italic">{active.source}</span> : null}
              </figcaption>
            ) : null}
          </figure>

          {items.length > 1 ? (
            <p className="mt-3 text-xs text-paper/60" aria-live="polite">
              {(openIndex ?? 0) + 1} из {items.length} · стрелки — переключение,
              Esc — закрыть
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}