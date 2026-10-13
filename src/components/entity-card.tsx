"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ENTITY_SLUG_ATTRIBUTE, entityHref, slugFromEntityHref, type EntityCardView } from "@/lib/entity-card";
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
      Подробнее об объекте
      <ArrowRight className="size-3" aria-hidden />
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

/** Ширина поповера и зазор до ссылки — оба считаются здесь, а не дублируются по разным блокам. */
const POPOVER_WIDTH = 320;
const POPOVER_GAP = 8;

/** Отступ от края окна. */
const POPOVER_MARGIN = 12;

/**
 * Высота компактной шапки, под которую нельзя уводить карточку.
 *
 * Шапка `fixed` высотой 52px и появляется после 120px прокрутки (см. `header-shell.tsx`), то
 * есть именно тогда, когда читатель открывает поповер в длинной статье. Карточка, раскрытая
 * под шапкой, выглядит как обрезанная и половины её не видно.
 */
const HEADER_HEIGHT = 52;

/**
 * Где рисовать поповер.
 *
 * Вынесено в чистую функцию, потому что ошибка тут видна только в момент открытия: карточка
 * появляется в углу экрана и прыгает на место. Позиция считается от прямоугольника ссылки, а
 * не от его середины и не от левого края — на длинной строке ссылка может начинаться в
 * середине абзаца, и поповер, привязанный к краю, уезжал бы от курсора.
 *
 * `below` — есть ли место под ссылкой; `viewportHeight` и `viewportWidth` передаются, чтобы
 * подсчёт был проверяемым без окна.
 */
export function popoverPosition(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { top: number; left: number } {
  let left = anchor.left + anchor.width / 2 - POPOVER_WIDTH / 2;
  left = Math.max(POPOVER_MARGIN, Math.min(left, viewportWidth - POPOVER_WIDTH - POPOVER_MARGIN));

  /*
    Под ссылкой — если влезает, над ней — если нет.

    Нижняя граница считается от низа шапки, а не от верха окна: поповер не должен заезжать под
    неё ни при каком положении ссылки.
  */
  const below = anchor.bottom + POPOVER_GAP;
  const ceiling = Math.max(POPOVER_MARGIN, HEADER_HEIGHT + POPOVER_GAP);
  const fitsBelow = below + cardHeight + POPOVER_MARGIN <= viewportHeight;

  const top = fitsBelow
    ? Math.max(ceiling, below)
    : Math.max(ceiling, anchor.top - POPOVER_GAP - cardHeight);

  /* Всё равно подрезаем снизу: карточка выше шапки может оказаться длиннее, чем окно целиком. */
  return { top: Math.min(top, Math.max(ceiling, viewportHeight - cardHeight - POPOVER_MARGIN)), left };
}

/** And how long it must be gone before the card closes. */
/**
 * How long a card stays on screen after the pointer leaves the link.
 *
 * 300 ms, and the number is the whole difference between a card that is reachable and one
 * that is not. The card sits 8 px below the link and is a separate element, so the pointer
 * has to cross a strip that belongs to neither of them; at 180 the crossing was inside the
 * window on a fast mouse and outside it on a slow one, which is the kind of bug that
 * reproduces for the person who reported it and nobody else.
 */
const CLOSE_DELAY_MS = 300;

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
  onKeepOpen,
  onClose,
}: {
  card: EntityCardView;
  /** The link that opened the card. Kept as an element, not a snapshot rectangle: see below. */
  anchor: HTMLElement;
  /** Cancels a pending close, so the card survives the pointer arriving on it. */
  onKeepOpen: () => void;
  onClose: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    /*
      Прямоугольник ссылки читается заново при каждом событии, а не хранится.

      Снимок `getBoundingClientRect()`, снятый в момент наведения, устаревает при первом же
      смещении страницы: ссылка уезжает из-под курсора, а карточка остаётся на месте. На
      длинной статье это происходит сразу — читатель чуть дёрнул колесом, и карточка осталась
      висеть над другим абзацем. Элемент в DOM всегда даёт актуальные координаты.
    */
    const place = () => {
      const element = anchor;
      const height = layer.current?.offsetHeight ?? 320;
      setPosition(
        popoverPosition(
          element.getBoundingClientRect(),
          height,
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  /*
    `useLayoutEffect`, а не `useEffect`: первый кадр обязан быть уже на месте.

    При `useEffect` браузер успевает отрисовать поповер в точке, от которой он стартует, —
    то есть в левом верхнем углу окна, — и только потом effect двигает его к ссылке. Читатель
    видел белый прямоугольник в углу, прыгающий к тексту. Пока координаты не посчитаны,
    карточка не рисуется вовсе (`invisible`), а не рисуется не на месте.
  */
  return (
    <div
      ref={layer}
      role="dialog"
      aria-label={card.title}
      style={position ? { top: position.top, left: position.left } : undefined}
      className={cn(
        "fixed z-50 w-[320px] rounded-lg border border-rule bg-white p-3 shadow-xl",
        position ? "visible" : "invisible",
      )}
      /*
        Entering the card *cancels* the close; leaving it starts one.

        It was `onMouseEnter={onClose}` — the card dismissed itself the instant the pointer
        arrived on it — and there was no `onMouseLeave` at all, so it never closed on its own
        either. One wrong prop produced both halves of the reported symptom: the card
        vanished as the reader reached for «Подробнее об объекте», and a card left behind
        after the pointer had gone stayed on screen until Escape.

        The 8 px between the link and the card is crossed while the link's close timer is
        running, which is what `CLOSE_DELAY_MS` is sized for. Entering the card before it
        fires cancels it, so the gap no longer decides whether the card is reachable.
      */
      onMouseEnter={onKeepOpen}
      onMouseLeave={onClose}
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
 * Заглушка на время загрузки карточки.
 *
 * Раньше она ставилась в `{top: anchor.bottom + 8, left: anchor.left}` — по левому краю
 * ссылки и без учёта краёв окна, тогда как готовая карточка считалась по центру и
 * подрезалась. Карточка открывалась на 160px левее заглушки и ниже её: читатель видел, как
 * блок переезжает. Теперь обе считает одна функция `popoverPosition`, с той же шириной и тем
 * же запасом от краёв.
 */
function EntityPlaceholder({ anchor, loading }: { anchor: HTMLElement; loading: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const height = layer.current?.offsetHeight ?? 44;
      setPosition(
        popoverPosition(
          anchor.getBoundingClientRect(),
          height,
          window.innerWidth,
          window.innerHeight,
        ),
      );
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
      aria-label="Карточка"
      style={position ? { top: position.top, left: position.left } : undefined}
      className={cn(
        "fixed z-50 flex w-[320px] items-center gap-2 rounded-lg border border-rule bg-white p-3 text-xs text-neutral-500 shadow-xl",
        position ? "visible" : "invisible",
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {loading ? "Открываем карточку…" : "Карточка недоступна"}
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

  const [active, setActive] = useState<{ slug: string; anchor: HTMLElement } | null>(null);
  const [card, setCard] = useState<EntityCardView | null>(null);
  const [loading, setLoading] = useState(false);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback((slug: string, anchor: HTMLElement) => {
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
      /*
        The slug, read through the same function the page and the sanitiser use.

        Not `href.startsWith("/entities/")` as it was: a card's address moved to `/wiki/`,
        bodies written before the move still carry the old prefix, and both are cards. One
        rule in one place is what keeps the three callers from disagreeing about which link
        opens a popover.
      */
      const slug = slugFromEntityHref(target?.getAttribute("href") ?? null);
      if (!slug || !target) return;

      // A touch device has no hover. This is the tap path, and it opens immediately: the
      // 150 ms dwell that makes a desktop popover feel deliberate would make a tap feel
      // broken. It is also the only path a reader without a pointer can reach.
      if (event.type === "click") {
        event.preventDefault();
        show(slug, target);
        return;
      }

      openTimer.current = setTimeout(() => {
        show(slug, target);
      }, OPEN_DELAY_MS);
    };

    const close = () => hide();

    /*
      Selected by the attribute the hook stamps, not by an href prefix.

      It is the one thing every card link carries whatever address it was written with, and
      it is set by the sanitiser from the href — so the selector cannot miss a card because
      the body was written before a rename.
    */
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>(`[${ENTITY_SLUG_ATTRIBUTE}]`),
    );

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
          <EntityPopover
            card={card}
            anchor={active.anchor}
            onKeepOpen={cancelTimers}
            onClose={hide}
          />
        ) : nothingToShow ? (
          <EntityPlaceholder anchor={active.anchor} loading={loading} />
        ) : null
      ) : null}
    </>
  );
}