import Link from "next/link";

import { countNewFeedItems } from "@/lib/feed-store";

/**
 * Shared chrome for the editorial area.
 *
 * This route group had no layout before, so every page drew its own header and
 * there was nowhere to put navigation — /admin/settings would have been
 * reachable only by typing the URL. The nav is a thin strip above each page's
 * own header, which keeps the page-level titles and actions where they were.
 *
 * Under /admin/:path*, so the Basic Auth guard in src/proxy.ts covers this layout
 * and the links below it.
 */

const NAV = [
  { href: "/admin/articles", label: "Материалы" },
  { href: "/admin/feed", label: "Предложка" },
  { href: "/admin/forum", label: "Форум" },
  { href: "/admin/settings", label: "Настройки" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /*
    The badge is the reason this layout is async. It has to be the number of items
    nobody has looked at yet, and that is only knowable from the database — a count
    rendered once and cached would show a zero that never changes, which is worse than
    no badge at all: it would tell the desk the wire is empty.
  */
  const pending = await countNewFeedItems();

  return (
    <div className="flex min-h-dvh flex-col">
      <nav
        aria-label="Разделы админки"
        className="flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-neutral-200 sm:px-6"
      >
        <span className="text-xs font-semibold tracking-[0.14em] uppercase">
          Ё-новости · редакция
        </span>

        <ul className="flex items-center gap-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
              >
                {item.label}
                {item.href === "/admin/feed" && pending > 0 ? (
                  <span
                    className="rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
                    aria-label={`Новых инфоповодов: ${pending}`}
                  >
                    {pending}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {children}
    </div>
  );
}