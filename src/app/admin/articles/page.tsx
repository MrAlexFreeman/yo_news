import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

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

export default async function ArticlesListPage() {
  const articles = await prisma.article.findMany({
    orderBy: { createdAt: "desc" },
    select: {
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
      createdAt: true,
      category: { select: { name: true } },
    },
  });

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900">Материалы</h1>
          <p className="text-xs text-neutral-500">
            Всего: {articles.length}
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

      <div className="flex-1 p-4">
        {articles.length === 0 ? (
          <p className="rounded border border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            Пока нет ни одного материала.
          </p>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded border border-neutral-300 bg-white text-sm">
            <thead>
              <tr className="bg-neutral-100 text-left text-xs tracking-wide text-neutral-500 uppercase">
                <th scope="col" className="px-3 py-2">Заголовок</th>
                <th scope="col" className="px-3 py-2">Рубрика</th>
                <th scope="col" className="px-3 py-2">Статус</th>
                <th scope="col" className="px-3 py-2">Публикация</th>
                <th scope="col" className="px-3 py-2 text-right">Просмотры</th>
                <th scope="col" className="px-3 py-2">Метки</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => {
                const status = isArticleStatus(article.status)
                  ? article.status
                  : "draft";

                return (
                  <tr key={article.id} className="border-t border-neutral-200">
                    <td className="px-3 py-2">
                      <span className="font-medium text-neutral-900">
                        {article.title}
                      </span>
                      <span className="block font-mono text-xs text-neutral-400">
                        /{article.slug}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {article.category?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          status === "published"
                            ? "bg-green-100 text-green-800"
                            : "bg-neutral-200 text-neutral-600",
                        )}
                      >
                        {STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {article.publishedAt
                        ? DATE_FORMAT.format(article.publishedAt)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {article.views}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {article.isDzen ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            Дзен
                          </span>
                        ) : null}
                        {article.isVk ? (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                            ВК
                          </span>
                        ) : null}
                        {article.isExclusive ? (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-800">
                            Эксклюзив
                          </span>
                        ) : null}
                        {article.is18plus ? (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                            18+
                          </span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
