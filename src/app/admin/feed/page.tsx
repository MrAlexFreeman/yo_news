import type { Metadata } from "next";
import Link from "next/link";

import { FeedList, type FeedRow } from "@/app/admin/feed/components/feed-list";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Предложка — Админка",
};

/**
 * The list is a live read of what the feeds brought in, so it must not be prerendered.
 */
export const dynamic = "force-dynamic";

/** Long enough to see what a story is about, short enough that ten rows fit. */
const PREVIEW_LENGTH = 220;

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type PageParams = { searchParams: Promise<{ view?: string }> };

/**
 * «Предложка» — the wire desk.
 *
 * Newest first, and hidden items behind a tab rather than in the same list at the
 * bottom: the working screen should contain only what still needs a decision. An item
 * that was hidden is one somebody has already decided about.
 */
export default async function FeedPage({ searchParams }: PageParams) {
  const { view } = await searchParams;
  const showIgnored = view === "ignored";
  const tab: "new" | "ignored" = showIgnored ? "ignored" : "new";

  const [items, newCount, ignoredCount] = await Promise.all([
    prisma.newsFeedItem.findMany({
      where: { status: showIgnored ? "IGNORED" : "NEW" },
      orderBy: { publishedAt: "desc" },
      // A screenful. The desk is for a morning's wire, not for an archive — and the
      // rest is one click away in the tab's own URL if it is ever needed.
      take: 100,
      select: {
        id: true,
        source: true,
        title: true,
        originalUrl: true,
        rawText: true,
        publishedAt: true,
        status: true,
      },
    }),
    prisma.newsFeedItem.count({ where: { status: "NEW" } }),
    prisma.newsFeedItem.count({ where: { status: "IGNORED" } }),
  ]);

  const rows: FeedRow[] = items.map((item) => ({
    id: item.id,
    source: item.source,
    title: item.title,
    originalUrl: item.originalUrl,
    preview:
      item.rawText.length > PREVIEW_LENGTH
        ? `${item.rawText.slice(0, PREVIEW_LENGTH).trimEnd()}…`
        : item.rawText,
    dateLabel: DATE_FORMAT.format(item.publishedAt),
    dateIso: item.publishedAt.toISOString(),
    status: item.status,
  }));

  const tabs = [
    { href: "/admin/feed", label: "Новые", count: newCount, active: !showIgnored },
    {
      href: "/admin/feed?view=ignored",
      label: "Скрытые",
      count: ignoredCount,
      active: showIgnored,
    },
  ] as const;

  return (
    <div className="flex-1 bg-neutral-100 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="border border-neutral-300 bg-white px-5 py-4">
          <h1 className="text-base font-semibold text-neutral-900">Предложка</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Инфоповоды из лент URA.RU и E1.RU. Из любого можно собрать черновик: форма
            откроется с текстом источника, а переписать его можно кнопкой рерайта.
          </p>
        </header>

        <nav aria-label="Списки инфоповодов" className="border-b border-neutral-300 bg-white px-4">
          <ul className="-mb-px flex gap-1">
            {tabs.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    item.active
                      ? "border-green-600 text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-800",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                      item.count > 0
                        ? "bg-neutral-200 text-neutral-700"
                        : "bg-neutral-100 text-neutral-400",
                    )}
                  >
                    {item.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <FeedList rows={rows} view={tab} />
      </div>
    </div>
  );
}
