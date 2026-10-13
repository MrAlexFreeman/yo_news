import { Search } from "lucide-react";
import Link from "next/link";

import { LiveBadge } from "@/components/live-badge";
import { LiveDateline } from "@/components/live-dateline";
import { Logo } from "@/components/logo";
import { NavPill } from "@/components/nav-pill";
import { TrendingBar } from "@/components/trending-bar";
import { formatDateline } from "@/lib/date";
import { LIVE_STREAM_OFF, type LiveStreamView } from "@/lib/live-stream";
import { SITE_TAGLINE } from "@/lib/site";
import type { CbrRates, Weather } from "@/lib/ticker";

type PublicHeaderProps = {
  /** Rubric links from the database, rendered as the scrollable nav row. */
  categories: { name: string; slug: string }[];
  /**
   * The topic strip under the rubric row. Empty means the strip is not rendered at all —
   * an install with no tags must not print a labelled bar with nothing in it.
   */
  trendingTags: { name: string; slug: string }[];
  /**
   * The live-stream badge, or the off view.
   *
   * Defaults to off rather than being required, so the component still renders in a check
   * that does not care about the badge. A caller that forgets to pass it gets the safe
   * outcome — no badge — instead of an error or, worse, an unconditional one.
   */
  live?: LiveStreamView;
  /** Живой курс ЦБ, либо null — тогда валютная строка не печатается. */
  rates?: CbrRates | null;
  /** Живая погода Екатеринбурга, либо null — тогда строка погоды не печатается. */
  weather?: Weather | null;
  /** Frozen so a statically generated page keeps the build-time dateline. */
  now: Date;
};

/**
 * Masthead: dateline + ticker on top, wordmark and controls in the middle, a
 * horizontally scrollable rubric strip of pill links below.
 */
export function PublicHeader({
  categories,
  trendingTags,
  live = LIVE_STREAM_OFF,
  rates = null,
  weather = null,
  now,
}: PublicHeaderProps) {
  /*
    Текст бегущей строки собран из живых данных, а не из зашитых цифр. Курс — с официального
    сайта ЦБ, погода — с open-meteo; что не удалось прочитать, то просто отсутствует. Зашитый
    «USD/RUB 92,40» выглядел как биржа, но биржей не был — полуправда в мачте хуже пустой строки.
  */
  const tickerItems = [
    weather
      ? `Екатеринбург ${weather.temp > 0 ? "+" : ""}${weather.temp}°C, ${weather.condition}`
      : null,
    rates ? `USD ${rates.usd.toFixed(2)} ₽` : null,
    rates ? `EUR ${rates.eur.toFixed(2)} ₽` : null,
  ].filter((item): item is string => item !== null);

  return (
    <>
      <header className="border-b border-rule bg-paper">
      {/* Top strip: date and the live ticker. The ticker is hidden on a phone — the first
          screen is for the masthead and the news, not for a market strip. */}
      <div className="border-b border-rule/70 bg-paper-dim text-[11px] text-ink-soft">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-1 sm:py-1.5">
          <LiveDateline
            initial={formatDateline(now)}
            initialIso={now.toISOString()}
          />

          {tickerItems.length > 0 ? (
            <>
              <span aria-hidden className="hidden h-3 w-px bg-rule sm:block" />

              <div
                className="relative hidden min-w-0 flex-1 overflow-hidden sm:block"
                aria-label="Курсы и погода"
              >
                {/* The track holds the list twice so the loop has no visible seam. */}
                <div className="ticker-track flex w-max gap-8 whitespace-nowrap">
                  {[...tickerItems, ...tickerItems].map((item, index) => (
                    <span key={`${item}-${index}`} className="text-ink-soft">
                      • {item}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/*
        Wordmark row. `py-2.5 sm:py-4` and a tagline hidden on the phone: the first screen is
        the product — the masthead has to say who this is and then get out of the way of the
        lead headline.
      */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:py-4">
        {/* No aria-label: the accessible name then equals the visible lockup,
            which is what the label-in-name rule requires. */}
        <Link href="/" className="group flex flex-col items-start gap-1 sm:gap-1.5">
          <Logo />
          <span className="hidden text-[10px] font-medium tracking-[0.2em] text-ink-soft uppercase group-hover:text-yo-ink sm:block">
            {SITE_TAGLINE}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {/*
            The live badge, or nothing at all. `LiveBadge` returns null when the stream is
            off, which is what keeps the search icon flush to the right edge instead of
            leaving the width of a label behind.
          */}
          <LiveBadge
            live={live}
            className="hidden sm:inline-flex"
          />

          {/* No link to /admin: the CMS is for editors, not readers. It stays
              reachable by typing the path, and Basic Auth in src/proxy.ts is the
              actual gate. */}
          <nav aria-label="Поиск по сайту">
            <Link
              href="/search"
              aria-label="Поиск"
              title="Поиск"
              className="rounded-full p-2 text-ink-soft transition-colors hover:bg-paper-dim hover:text-ink"
            >
              <Search className="size-5" aria-hidden />
            </Link>
          </nav>
        </div>
      </div>

      {/* Rubric strip: pill links, scrollable on narrow screens.

          There is no drawer or burger menu on this site, and the forum does not need
          one: this row scrolls horizontally on a phone and every pill carries
          `shrink-0`, so the forum is reachable without a tap-to-open step. Adding a
          mobile menu just for one link would be a second navigation to keep in step. */}
      <nav aria-label="Рубрики" className="border-t border-rule">
        <ul className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 py-1.5 sm:py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0">
            <NavPill href="/" label="Все новости" />
          </li>
          {categories.map((category) => (
            <li key={category.slug} className="shrink-0">
              <NavPill
                href={`/category/${category.slug}`}
                label={category.name}
              />
            </li>
          ))}
          {/* The forum sits after the rubrics rather than among them, because it is
              not one: the pills above are filters over the same feed. */}
          <li className="shrink-0">
            <NavPill href="/forum" label="Форум" tone="muted" />
          </li>
        </ul>
      </nav>
      </header>

      {/*
        The topic strip, rendered immediately under the rubric pills but *outside* the
        <header>. Not a styling accident: the header is the masthead and the rubric row is
        its navigation, while this is editorial content — a link list that changes with the
        news. A list that changes belongs to the page, not to the site header, and a
        screen reader walking the landmarks should meet it as content rather than as part
        of the banner.
      */}
      <TrendingBar tags={trendingTags} />
    </>
  );
}
