"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { entityHref, type EntityCardView } from "@/lib/entity-card";
import { cn } from "@/lib/utils";

/**
 * One card's worth of content, in the popover and on the standalone page.
 *
 * Split out from the popover so the same markup — the gallery, the facts, the summary —
 * serves both, and a reader who follows the link to `/entities/<slug>` sees the identical
 * thing rather than a plainer page.
 */

/** The gallery. One frame, arrows, dots. */
export function EntityGallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0);

  // A card edited to have fewer pictures must not leave the carousel pointing past its
  // last frame — which is a broken image rather than an empty gallery.
  const safeIndex = images.length === 0 ? 0 : Math.min(index, images.length - 1);

  if (images.length === 0) return null;

  const step = (delta: number) =>
    setIndex((current) => (current + delta + images.length) % images.length);

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[safeIndex]}
        alt={`${alt} — фото ${safeIndex + 1}`}
        loading="lazy"
        className="h-40 w-full rounded-md bg-neutral-100 object-cover"
      />

      {images.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Предыдущее фото"
            className="absolute left-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-700 shadow-sm transition-colors hover:bg-white"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Следующее фото"
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-700 shadow-sm transition-colors hover:bg-white"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>

          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5">
            {images.map((image, dot) => (
              <button
                key={image}
                type="button"
                onClick={() => setIndex(dot)}
                aria-label={`Фото ${dot + 1}`}
                aria-current={dot === safeIndex}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  dot === safeIndex ? "bg-white" : "bg-white/50",
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The facts a reader wants before deciding whether to open the card. */
export function EntityFacts({ card }: { card: EntityCardView }) {
  const facts: { label: string; value: string }[] = [];

  if (card.foundedYear) facts.push({ label: "Веха", value: card.foundedYear });
  if (card.location) facts.push({ label: "Где", value: card.location });

  if (facts.length === 0) return null;

  return (
    <dl className="mt-2 space-y-0.5 text-xs text-neutral-600">
      {facts.map((fact) => (
        <div key={fact.label} className="flex gap-1.5">
          <dt className="shrink-0 text-neutral-400">{fact.label}:</dt>
          <dd className="min-w-0">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The link out, shown in the popover only. */
export function EntityOutboundLink({ card }: { card: EntityCardView }) {
  return (
    <a
      href={entityHref(card.slug)}
      className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
    >
      Открыть карточку
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/**
 * Cards this session has already fetched.
 *
 * Keyed by slug and shared by every popover on the page, so opening a card twice — the
 * reader moves off it and comes back — costs one request in total rather than one per
 * hover. A failed fetch is cached too, as `null`: a card that 404s must not be requested
 * again on every mouse movement for the rest of the read.
 */
type Cache = Map<string, EntityCardView | null>;

async function fetchCard(slug: string): Promise<EntityCardView | null> {
  try {
    const response = await fetch(`/api/entities/${encodeURIComponent(slug)}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { card?: EntityCardView };
    return payload.card ?? null;
  } catch {
    // Offline, or the endpoint gone. A card is an enrichment, never the article itself,
    // so a failure here must not surface as an error to the reader.
    return null;
  }
}

/** How long the pointer must rest before the card opens. */
const OPEN_DELAY_MS = 150;

/** And how long it must be gone before the card closes. */
const CLOSE_DELAY_MS = 180;

/**
 * The popover itself: positioned near the link that opened it.
 *
 * Rendered in a fixed layer rather than next to the link, because an article body sets
 * `overflow` on several ancestors for its own reasons and a popover nested inside one of
 * them gets clipped. The position is computed from the link's rectangle on open and kept
 * in sync with scroll and resize, which is the part that has to be right for a card in a
 * long story to stay on screen.
 */
function EntityPopover({
  card,
  anchor,
  onClose,
}: {
  card: EntityCardView;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const place = () => {
      const width = 320;
      const gap = 8;
      const margin = 12;

      const viewportWidth = window.innerWidth;
      // Centred on the link, then clamped: a card on a link near the right edge would
      // otherwise open half off-screen, which on a phone is most of it.
      let left = anchor.left + anchor.width / 2 - width / 2;
      left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

      // Below the link when there is room, above it otherwise. A card for the last
      // paragraph of a story would otherwise open off the bottom of the viewport.
      const height = layer.current?.offsetHeight ?? 320;
      const below = anchor.bottom + gap;
      const fitsBelow = below + height + margin < window.innerHeight;
      const top = fitsBelow ? below : Math.max(margin, anchor.top - gap - height);

      setPosition({ top, left });
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  return (
    <div
      ref={layer}
      role="dialog"
      aria-label={card.title}
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onClose}
      className="fixed z-50 w-[320px] rounded-lg border border-rule bg-white p-3 shadow-xl"
    >
      {card.category ? (
        <span className="mb-1.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {card.category}
        </span>
      ) : null}

      <h3 className="text-sm font-semibold leading-snug text-ink">{card.title}</h3>

      {card.images.length > 0 ? (
        <div className="mt-2">
          <EntityGallery images={card.images} alt={card.title} />
        </div>
      ) : null}

      <EntityFacts card={card} />

      <p className="mt-2 text-xs leading-relaxed text-neutral-700">{card.summary}</p>

      <EntityOutboundLink card={card} />
    </div>
  );
}

/**
 * Upgrades entity links inside a rendered article body into hoverable cards.
 *
 * A client component that receives the already-sanitised HTML and renders it, then walks
 * its own output for links whose href is a card address. This runs *after* the sanitiser
 * rather than replacing it: the markup that reaches the DOM is exactly what
 * `sanitizeArticleHtml` produced, and this only adds behaviour on top of it.
 *
 * The body is set with `dangerouslySetInnerHTML` and nothing is done to that HTML after
 * it lands — the walk reads the anchor's `href` and attaches listeners, and rewrites
 * nothing. A reader with JavaScript off still gets the link, which is the reason the
 * address is a real path.
 */
export function ArticleBodyWithCards({ html, className }: { html: string; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const cache = useRef<Cache>(new Map());

  const [active, setActive] = useState<{ slug: string; anchor: DOMRect } | null>(null);
  const [card, setCard] = useState<EntityCardView | null>(null);
  const [loading, setLoading] = useState(false);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback((slug: string, anchor: DOMRect) => {
    cancelTimers();
    setActive({ slug, anchor });

    const cached = cache.current.get(slug);
    if (cached !== undefined) {
      setCard(cached);
      return;
    }

    setLoading(true);
    void fetchCard(slug).then((result) => {
      cache.current.set(slug, result);
      setCard(result);
      setLoading(false);
    });
  }, [cancelTimers]);

  const hide = useCallback(() => {
    cancelTimers();
    // A short grace period, so moving the pointer from the link to the card — which is
    // the only way to reach the gallery arrows and the outbound link — does not close it.
    closeTimer.current = setTimeout(() => {
      setActive(null);
      setCard(null);
    }, CLOSE_DELAY_MS);
  }, [cancelTimers]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const open = (event: Event) => {
      const target = (event.currentTarget as HTMLElement | null)?.closest?.("a");
      const href = target?.getAttribute("href");
      if (!href || !href.startsWith("/entities/")) return;

      // A touch device has no hover. This is the tap path, and it opens immediately: the
      // 150 ms dwell that makes a desktop popover feel deliberate would make a tap feel
      // broken. It is also the only path a reader without a pointer can reach.
      if (event.type === "click") {
        event.preventDefault();
        show(href.slice("/entities/".length), target!.getBoundingClientRect());
        return;
      }

      openTimer.current = setTimeout(() => {
        show(href.slice("/entities/".length), target!.getBoundingClientRect());
      }, OPEN_DELAY_MS);
    };

    const close = () => hide();

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/entities/"]'));

    for (const link of links) {
      link.addEventListener("mouseenter", open);
      link.addEventListener("mouseleave", close);
      link.addEventListener("focus", open);
      link.addEventListener("blur", close);
      // Tap on a phone, and the click that a keyboard Enter produces. Both are prevented
      // so the page is not navigated away from; the card offers the link out explicitly.
      link.addEventListener("click", open);
    }

    return () => {
      cancelTimers();
      for (const link of links) {
        link.removeEventListener("mouseenter", open);
        link.removeEventListener("mouseleave", close);
        link.removeEventListener("focus", open);
        link.removeEventListener("blur", close);
        link.removeEventListener("click", open);
      }
    };
  }, [show, hide, cancelTimers, html]);

  // Escape closes, which is the only way out for a keyboard user once the card is open.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelTimers();
        setActive(null);
        setCard(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, cancelTimers]);

  const slug = active?.slug ?? "";
  // A link to a card that does not exist must not leave an empty box on screen; the
  // reader follows the link and gets the 404 page, which is honest.
  const nothingToShow = loading || (card !== null && card.slug !== slug);

  return (
    <>
      <div ref={container} className={className} dangerouslySetInnerHTML={{ __html: html }} />

      {active && slug ? (
        card ? (
          <EntityPopover card={card} anchor={active.anchor} onClose={hide} />
        ) : nothingToShow && !loading ? (
          <div
            role="dialog"
            aria-label="Карточка"
            style={{ top: active.anchor.bottom + 8, left: active.anchor.left }}
            className="fixed z-50 flex w-[320px] items-center gap-2 rounded-lg border border-rule bg-white p-3 text-xs text-neutral-500 shadow-xl"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {loading ? "Открываем карточку…" : "Карточка недоступна"}
          </div>
        ) : null
      ) : null}
    </>
  );
}