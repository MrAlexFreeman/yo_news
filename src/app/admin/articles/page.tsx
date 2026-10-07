import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import {
  ArticlesTable,
  type ArticleRow,
} from "@/app/admin/articles/components/articles-table";
import { isArticleStatus } from "@/lib/article-status";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Материалы — Админка",
};

/**
 * The editorial list must reflect the database immediately. Without this the
 * page is a pure DB read with no request-time API, so Next prerenders it at
 * build time and editors would only see new articles after a redeploy.
 */
export const dynamic = "force-dynamic";

const STATUS_LABELS = {
  draft: "Черновик",
  published: "Опубликован",
} as const;

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type PageParams = { searchParams: Promise<{ view?: string }> };

/** Row shape the table needs; shared by both tabs so the columns cannot drift. */
const ROW_FIELDS = {
  id: true,
  title: true,
  slug: true,
  status: true,
  isDzen: true,
  isVk: true,
  isExclusive: true,
  is18plus: true,
  views: true,
  publishedAt: true,
  deletedAt: true,
  category: { select: { name: true } },
} as const;

type ArticleRowRecord = {
  id: string;
  title: string;
  slug: string;
  status: string;
  isDzen: boolean;
  isVk: boolean;
  isExclusive: boolean;
  is18plus: boolean;
  views: number;
  publishedAt: Date | null;
  deletedAt: Date | null;
  category: { name: string } | null;
};

function toRow(
  article: ArticleRowRecord,
  view: "active" | "trash",
): ArticleRow {
  // The trash column shows when the story was trashed; the active list shows when it
  // went out. One row shape, and the cell that differs is chosen here rather than in
  // the component, so a second caller cannot pick the wrong date.
  const stamp = view === "trash" ? article.deletedAt : article.publishedAt;

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    status: isArticleStatus(article.status) ? article.status : "draft",
    categoryName: article.category?.name ?? null,
    views: article.views,
    dateLabel: stamp ? DATE_FORMAT.format(stamp) : null,
    dateIso: stamp ? stamp.toISOString() : null,
    isDzen: article.isDzen,
    isVk: article.isVk,
    isExclusive: article.isExclusive,
    is18plus: article.is18plus,
  };
}

export default async function ArticlesListPage({ searchParams }: PageParams) {
  const { view } = await searchParams;
  /*
    Only the exact string "trash" switches tabs. Anything else falls back to the active
    list rather than 404ing: the parameter arrives from a link an editor may have typed
    by hand, and a typo in `?veiw=trash` should show the newsroom, not an error.
  */
  const showTrash = view === "trash";
  const tab: "active" | "trash" = showTrash ? "trash" : "active";

  /*
    Both lists and the trash count are read in one round trip each, and the count is a
    separate query rather than `articles.length`: the tab is labelled "Корзина (N)" and
    that N has to be the whole bin even when the bin holds more rows than one page shows.
  */
  const [articles, trashedCount] = await Promise.all([
    prisma.article.findMany({
      where: showTrash ? { deletedAt: { not: null } } : { deletedAt: null },
      orderBy: showTrash ? { deletedAt: "desc" } : { createdAt: "desc" },
      select: ROW_FIELDS,
    }),
    prisma.article.count({ where: { deletedAt: { not: null } } }),
  ]);

  const rows = articles.map((article) => toRow(article, tab));

  const tabs = [
    { href: "/admin/articles", label: "Все статьи", count: null },
    {
      href: "/admin/articles?view=trash",
      label: "Корзина",
      count: trashedCount,
    },
  ] as const;

  return (
    <div className="flex flex-1 flex-col bg-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900">Материалы</h1>
          <p className="text-xs text-neutral-500">
            {showTrash
              ? `В корзине: ${trashedCount}`
              : `Всего: ${articles.length}`}
          </p>
        </div>
        <Link
          href="/admin/articles/new"
          className="flex items-center gap-2 rounded-sm bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
        >
          <Plus className="size-4" aria-hidden />
          Создать материал
        </Link>
      </header>

      {/*
        The tabs are links, not buttons: each one is its own URL, so the browser's back
        button, a bookmark and a reload all behave the way an editor expects. `aria-current`
        marks the one in view, which is also what keeps the styling honest — the active
        tab is styled from the same condition rather than from a separate piece of state.
      */}
      <nav aria-label="Списки материалов" className="border-b border-neutral-300 bg-white px-6">
        <ul className="-mb-px flex gap-1">
          {tabs.map((tab) => {
            const active =
              tab.href === "/admin/articles" ? !showTrash : showTrash;

            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-green-600 text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-800",
                  )}
                >
                  {tab.label}
                  {tab.count !== null ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                        tab.count > 0
                          ? "bg-neutral-200 text-neutral-700"
                          : "bg-neutral-100 text-neutral-400",
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex-1 p-4">
        {rows.length === 0 ? (
          <p className="rounded border border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            {showTrash
              ? "Корзина пуста."
              : "Пока нет ни одного материала."}
          </p>
        ) : (
          <ArticlesTable
            rows={rows}
            view={tab}
            statusLabels={STATUS_LABELS}
          />
        )}
      </div>
    </div>
  );
}
