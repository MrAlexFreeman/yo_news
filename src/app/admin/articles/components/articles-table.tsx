"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { hardDeleteArticles, restoreArticles, softDeleteArticles } from "@/app/admin/articles/actions";

/**
 * The editorial table, with row selection.
 *
 * A client component for one reason: "Выбрано: N" has to update as the boxes are
 * ticked, which a server-rendered table cannot do without a round trip per click. The
 * rows arrive as plain strings and the writes go through server actions, so no article
 * data is exposed to the browser beyond the columns already on screen.
 *
 * Selection is state that does not survive a reload on purpose. An editor who ticked
 * four boxes, walked away and came back would find a destructive button armed with ids
 * they can no longer see; starting from empty every time is the safer default.
 */

export type ArticleRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  categoryName: string | null;
  views: number;
  /**
   * Already formatted on the server, together with the ISO string for `<time>`.
   * Pre-formatting matters here: the page is statically rendered and a browser that
   * formats the date itself would pick its own zone, so a Moscow editor could see a
   * deletion time shifted by hours.
   */
  dateLabel: string | null;
  dateIso: string | null;
  isDzen: boolean;
  isVk: boolean;
  isExclusive: boolean;
  is18plus: boolean;
};

type ArticlesTableProps = {
  rows: ArticleRow[];
  /** Which list is on screen. Drives the labels and which actions are offered. */
  view: "active" | "trash";
  statusLabels: Record<string, string>;
};

/** What the markup needs to know, and what it calls back into. */
export type ArticlesTableViewProps = ArticlesTableProps & {
  selected: ReadonlySet<string>;
  allSelected: boolean;
  pending: boolean;
  notice: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onBulk: () => void;
  /**
   * The per-row button, told which one was pressed.
   *
   * A single handler with a guessed meaning would be a trap: in the trash the row carries
   * both "Вернуть" and "Удалить", and the two differ only in what happens to the row and
   * whether the file on disk survives.
   */
  onRow: (id: string, action: "trash" | "restore" | "destroy") => void;
};

/**
 * The markup, with no state and no router.
 *
 * Split out for the same reason `ForumTopicsBlock` is its own component: `useRouter`
 * throws unless the App Router is mounted, so the whole table could not be rendered —
 * and therefore not checked — by `trash:check`. Everything the eye reads lives here, and
 * the container above it owns only what a browser has to own.
 */
export function ArticlesTableView({
  rows,
  view,
  statusLabels,
  selected,
  allSelected,
  pending,
  notice,
  onToggle,
  onToggleAll,
  onBulk,
  onRow,
}: ArticlesTableViewProps) {
  const trashed = view === "trash";
  const count = selected.size;

  return (
    <div className="flex flex-col gap-3">
      {/*
        The bulk bar. `aria-live` because the count is announced to a screen reader the
        moment it changes, and that is the only way a non-sighted editor learns what the
        button they are about to press is armed with.
      */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-white px-3 py-2"
      >
        <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            disabled={rows.length === 0 || pending}
            className="size-4 accent-green-600"
          />
          Выбрать все
        </label>

        <span className="text-sm text-neutral-700" data-selected-count={count}>
          {count > 0 ? `Выбрано: ${count}` : "Ничего не выбрано"}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {trashed ? (
            <>
              <button
                type="button"
                disabled={count === 0 || pending}
                onClick={onBulk}
                className="inline-flex items-center gap-1.5 rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Вернуть из корзины
              </button>
              <button
                type="button"
                disabled={count === 0 || pending}
                onClick={onBulk}
                className="inline-flex items-center gap-1.5 rounded-sm bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Удалить выбранные
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={count === 0 || pending}
              onClick={onBulk}
              className="inline-flex items-center gap-1.5 rounded-sm bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Удалить выбранные
            </button>
          )}
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700"
        >
          {notice}
        </p>
      ) : null}

      <table className="w-full border-collapse overflow-hidden rounded border border-neutral-300 bg-white text-sm">
        <thead>
          <tr className="bg-neutral-100 text-left text-xs tracking-wide text-neutral-500 uppercase">
            <th scope="col" className="w-10 px-3 py-2">
              <span className="sr-only">Выбрать</span>
            </th>
            <th scope="col" className="px-3 py-2">Заголовок</th>
            <th scope="col" className="px-3 py-2">Рубрика</th>
            <th scope="col" className="px-3 py-2">Статус</th>
            <th scope="col" className="px-3 py-2">
              {trashed ? "Удалён" : "Публикация"}
            </th>
            <th scope="col" className="px-3 py-2 text-right">Просмотры</th>
            <th scope="col" className="px-3 py-2">Метки</th>
            <th scope="col" className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((article) => (
            <tr
              key={article.id}
              className={`border-t border-neutral-200 ${selected.has(article.id) ? "bg-green-50" : ""}`}
            >
              <td className="px-3 py-2 align-top">
                <input
                  type="checkbox"
                  checked={selected.has(article.id)}
                  onChange={() => onToggle(article.id)}
                  disabled={pending}
                  aria-label={`Выбрать материал «${article.title}»`}
                  className="size-4 accent-green-600"
                />
              </td>

              <td className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-900">
                      {article.title}
                    </span>
                    <span className="block font-mono text-xs text-neutral-400">
                      /{article.slug}
                    </span>
                  </div>
                  {/* The edit route used to be missing entirely, so a draft could
                      never be opened and re-published. */}
                  {!trashed ? (
                    <Link
                      href={`/admin/articles/${article.id}/edit`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                    >
                      Изменить
                    </Link>
                  ) : null}
                </div>
              </td>

              <td className="px-3 py-2 text-neutral-600">
                {article.categoryName ?? "—"}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    article.status === "published"
                      ? "bg-green-100 text-green-800"
                      : "bg-neutral-200 text-neutral-600"
                  }`}
                >
                  {statusLabels[article.status] ?? "Черновик"}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-neutral-500">
                {article.dateIso ? (
                  <time dateTime={article.dateIso}>{article.dateLabel}</time>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{article.views}</td>
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

              <td className="px-3 py-2 text-right">
                {trashed ? (
                  <span className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onRow(article.id, "restore")}
                      title="Вернуть из корзины"
                      className="inline-flex items-center gap-1.5 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      Вернуть
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onRow(article.id, "destroy")}
                      title="Удалить навсегда"
                      className="inline-flex items-center gap-1.5 rounded-sm bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      Удалить
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onRow(article.id, "trash")}
                    title="В корзину"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    В корзину
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Owns the selection and calls the server actions. */
export function ArticlesTable({ rows, view, statusLabels }: ArticlesTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const trashed = view === "trash";
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  /**
    * Runs an action and reports what it said.
   *
   * `router.refresh()` is called on success because the actions only invalidate cached
   * paths — the admin list is `force-dynamic`, so it has no cached copy to replace, and
   * without this the row would sit on screen until somebody reloaded by hand.
   */
  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setNotice(result.message);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  /*
    The confirmations live here rather than in the markup, so the markup stays a pure
    function of props and can be rendered — and checked — outside a browser.
  */
  function bulk() {
    const count = selected.size;

    if (trashed) {
      if (
        !window.confirm(
          count === 1
            ? "Вернуть материал из корзины? Он сразу появится на сайте."
            : `Вернуть ${count} из корзины? Материалы сразу появятся на сайте.`,
        )
      ) {
        return;
      }
      run(() => restoreArticles([...selected]));
      return;
    }

    if (
      !window.confirm(
        count === 1
          ? "Переместить материал в корзину? Он пропадёт с сайта, но его можно будет вернуть."
          : `Переместить ${count} в корзину? Они пропадут с сайта, но их можно будет вернуть.`,
      )
    ) {
      return;
    }
    run(() => softDeleteArticles([...selected]));
  }

  /** The per-row button. Which of the three it is, the markup says. */
  function single(id: string, action: "trash" | "restore" | "destroy") {
    const article = rows.find((row) => row.id === id);
    const title = article ? `«${article.title}»` : "этот материал";

    if (action === "restore") {
      if (!window.confirm(`Вернуть ${title} из корзины? Он сразу появится на сайте.`)) {
        return;
      }
      run(() => restoreArticles([id]));
      return;
    }

    if (action === "destroy") {
      if (
        !window.confirm(
          `Удалить ${title} навсегда? Это необратимо: материал, его файлы обложек и метки будут удалены без возможности восстановления.`,
        )
      ) {
        return;
      }
      run(() => hardDeleteArticles([id]));
      return;
    }

    if (
      !window.confirm(
        `Переместить ${title} в корзину? Он пропадёт с сайта, но его можно будет вернуть из корзины в списке материалов.`,
      )
    ) {
      return;
    }
    run(() => softDeleteArticles([id]));
  }

  return (
    <ArticlesTableView
      rows={rows}
      view={view}
      statusLabels={statusLabels}
      selected={selected}
      allSelected={allSelected}
      pending={pending}
      notice={notice}
      onToggle={toggle}
      onToggleAll={toggleAll}
      onBulk={bulk}
      onRow={single}
    />
  );
}
