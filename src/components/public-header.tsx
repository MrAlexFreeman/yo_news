import { Search } from "lucide-react";
import Link from "next/link";

import { LiveDateline } from "@/components/live-dateline";
import { Logo } from "@/components/logo";
import { formatDateline } from "@/lib/date";
import { SITE_TAGLINE } from "@/lib/site";

/** Static market strip — the spec asks for a fixed weather/rate line. */
const TICKER_ITEMS = [
  "Екатеринбург +16°C, переменная облачность",
  "USD/RUB 92,40 ▲ 0,12",
  "EUR/RUB 100,15 ▼ 0,08",
  "Главные темы: транспорт, ЖКХ, образование, спорт",
];

type PublicHeaderProps = {
  /** Rubric links from the database, rendered as the scrollable nav row. */
  categories: { name: string; slug: string }[];
  /** Frozen so a statically generated page keeps the build-time dateline. */
  now: Date;
};

/**
 * Masthead: dateline + ticker on top, wordmark and controls in the middle, a
 * horizontally scrollable rubric strip of pill links below.
 */
export function PublicHeader({ categories, now }: PublicHeaderProps) {
  return (
    <header className="border-b border-rule bg-paper">
      {/* Top strip: date and the ticker. */}
      <div className="border-b border-rule/70 bg-paper-dim text-[11px] text-ink-soft">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-1.5">
          <LiveDateline
            initial={formatDateline(now)}
            initialIso={now.toISOString()}
          />

          <span aria-hidden className="hidden h-3 w-px bg-rule sm:block" />

          <div
            className="relative min-w-0 flex-1 overflow-hidden"
            aria-label="Главные темы"
          >
            {/* The track holds the list twice so the loop has no visible seam. */}
            <div className="ticker-track flex w-max gap-8 whitespace-nowrap">
              {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, index) => (
                <span key={`${item}-${index}`} className="text-ink-soft">
                  • {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Wordmark row. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
        {/* No aria-label: the accessible name then equals the visible lockup,
            which is what the label-in-name rule requires. */}
        <Link href="/" className="group flex flex-col items-start gap-1.5">
          <Logo />
          <span className="text-[10px] font-medium tracking-[0.2em] text-ink-soft uppercase group-hover:text-yo-ink">
            {SITE_TAGLINE}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {/* Live badge with a pulsing indicator. */}
          <span className="hidden items-center gap-2 rounded-full border border-live/30 bg-live/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-live-ink uppercase sm:inline-flex">
            <span
              className="live-dot size-2 rounded-full bg-live"
              aria-hidden
            />
            Прямой эфир
          </span>

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

      {/* Rubric strip: pill links, scrollable on narrow screens. */}
      <nav aria-label="Рубрики" className="border-t border-rule">
        <ul className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li className="shrink-0">
            <Link
              href="/"
              aria-current="page"
              className="inline-flex min-h-8 items-center rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold tracking-wide text-paper transition-transform hover:scale-[1.03]"
            >
              Все новости
            </Link>
          </li>
          {categories.map((category) => (
            <li key={category.slug} className="shrink-0">
              <Link
                href={`/category/${category.slug}`}
                className="inline-flex min-h-8 items-center rounded-full border border-rule bg-white px-3.5 py-1.5 text-xs font-semibold tracking-wide text-ink-soft transition-all hover:border-yo hover:bg-yo/5 hover:text-yo-ink hover:shadow-xs"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
