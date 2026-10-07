"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { hardDeleteArticles, restoreArticles, softDeleteArticles } from "@/app/admin/articles/actions";
import { cn } from "@/lib/utils";

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
  onClear: () => void;
  /**
   * A bulk action, named rather than guessed from the tab.
   *
   * This was one handler that branched on the tab, and the trash view gave it two buttons
   * — "Вернуть из корзины" and "Удалить выбранные" — both wired to it. It restored either
   * way, so a button labelled "delete" quietly undid the deletion instead of performing
   * it. Naming the action is the only thing that tells the two apart; the markup check
   * that should have caught it only looked for the labels.
   */
  onBulk: (action: "trash" | "restore" | "destroy") => void;
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
  onClear,
  onBulk,
  onRow,
}: ArticlesTableViewProps) {
  const trashed = view === "trash";
  const count = selected.size;
  const anySelected = count > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        /*
          Room for the floating bar, and only while it is on screen.

          Padding at the bottom extends the scroll range without moving anything above it,
          so taking it back when the selection clears costs no scroll position — where a
          fixed 6rem gap would sit empty under every unselected table.
        */
        anySelected && "pb-24",
      )}
    >
      {/*
        The table's own controls: select-all and a pointer to where the actions will be.
        The action buttons live in the floating bar only. Two sets of destructive buttons
        over one selection is a hazard rather than a convenience — and the bar's count is
        the single `aria-live` region, so a second copy would announce every tick twice.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-white px-3 py-2">
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

        <span className="text-xs text-neutral-500" data-selection-hint>
          {anySelected
            ? "Действия для выбранных — внизу экрана."
            : "Отметьте строки, чтобы применить действие сразу к нескольким."}
        </span>
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

      {/*
        The floating bar.

        Fixed rather than sticky because the target is the bottom of a long table: an
        editor who ticks the last row is already there, and one who ticks the first is
        70 rows up. `bottom-6 left-1/2 -translate-x-1/2` centres it; nothing between here
        and the viewport has a transform or `contain`, which would make `fixed` resolve
        against that ancestor instead and pin the bar to the table.

        The bar is always mounted so it can animate, and it is hidden with `invisible`
        rather than by unmounting. That matters for the keyboard: `opacity-0` alone leaves
        its buttons in the tab order, so tabbing from the first row would walk through two
        invisible controls before reaching anything. `visibility: hidden` removes them.

        The count is the one `aria-live` region on the page, so a screen reader hears the
        selection change once and knows what the button next to it is armed with.
      */}
      <div
        data-bulk-bar=""
        aria-live="polite"
        className={cn(
          // Centred with a translate rather than `inset-x-0` + `mx-auto`: both left and
          // right pinned would stretch the bar to the viewport, and `w-fit` would only win
          // because it happens to come later in the cascade.
          "fixed bottom-6 left-1/2 z-40 w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2",
          "flex items-center gap-4 rounded-xl border border-neutral-300 bg-white px-5 py-3 shadow-2xl",
          /*
            Visibility is kept out of the transition on the way in, and put back on it on
            the way out.

            `transition-all` on the way in was measurably fragile: `visibility` is a
            discrete property, so the bar's visibility depended on the transition advancing
            — and a document the browser is not painting gets no frames, so the bar sat
            invisible while the selection was active. Measured, not theorised: with
            `transition-all`, ticking a row left the bar at `visibility: hidden`,
            `opacity: 0` indefinitely in a hidden tab. So the show path animates only
            opacity and transform and flips `visibility` at once; the hide path fades out
            first and adds `visibility` to the transition with a delay, so it disappears
            after the fade rather than snapping.
          */
          anySelected
            ? "visible translate-y-0 opacity-100 transition-[opacity,transform] duration-200"
            : "invisible pointer-events-none translate-y-4 opacity-0 transition-[opacity,transform,visibility] duration-200 delay-150",
        )}
      >
        <span
          className="whitespace-nowrap text-sm font-medium text-neutral-900"
          data-selected-count={count}
        >
          {anySelected ? `Выбрано: ${count}` : "Ничего не выбрано"}
        </span>

        {/*
          Clearing the selection is the way back, and it has to be a button rather than a
          habit: the ids behind "Удалить выбранные" are no longer on screen to check
          against.
        */}
        <button
          type="button"
          onClick={onClear}
          disabled={!anySelected || pending}
          className="whitespace-nowrap rounded-sm border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Снять выбор
        </button>

        {trashed ? (
          <>
            <button
              type="button"
              disabled={!anySelected || pending}
              onClick={() => onBulk("restore")}
              data-bulk-action="restore"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Вернуть из корзины
            </button>
            <button
              type="button"
              disabled={!anySelected || pending}
              onClick={() => onBulk("destroy")}
              data-bulk-action="destroy"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Удалить выбранные
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!anySelected || pending}
            onClick={() => onBulk("trash")}
            data-bulk-action="trash"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden />
            В корзину
          </button>
        )}
      </div>
    </div>
  );
}

/** Owns the selection and calls the server actions. */
export function ArticlesTable({ rows, view, statusLabels }: ArticlesTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

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

  /** Backs the bar's "Снять выбор": nothing destructive, no confirmation needed. */
  function clear() {
    setSelected(new Set());
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

    Three separate branches, each with its own wording, because the three actions cost the
    editor different things: one is reversible, one is reversible, one is neither. A single
    shared prompt would have to be worded so weakly that it stops warning about the case it
    exists for.
  */
  function bulk(action: "trash" | "restore" | "destroy") {
    const count = selected.size;
    const subject =
      count === 1 ? "материал" : `материалы (${count})`;

    if (action === "restore") {
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

    if (action === "destroy") {
      if (
        !window.confirm(
          `Удалить ${subject} навсегда? Это необратимо: материалы, их файлы обложек и метки будут удалены без возможности восстановления.`,
        )
      ) {
        return;
      }
      run(() => hardDeleteArticles([...selected]));
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
      onClear={clear}
      onBulk={bulk}
      onRow={single}
    />
  );
}
