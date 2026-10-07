"use client";

import { CheckCircle2, Rocket, Save, Trash2, Undo2 } from "lucide-react";

type StickyActionBarProps = {
  pending: boolean;
  /** Deletion needs a persisted record; a brand new article has none yet. */
  canDelete: boolean;
  /** Drafts get an explicit publish button; published ones do not need it. */
  showPublish: boolean;
  /** True when the form holds edits that have not been saved yet. */
  dirty: boolean;
  onCancel: () => void;
  onDelete: () => void;
};

/**
 * Full-width sticky footer with the editorial actions.
 *
 * "Отменить" reverts unsaved edits back to the last saved state. It used to
 * reset the form to empty, which threw away a headline and a body the editor had
 * just typed with no way back — and it sat right next to the upload controls,
 * where it was easy to hit by accident.
 */
export function StickyActionBar({
  pending,
  canDelete,
  showPublish,
  dirty,
  onCancel,
  onDelete,
}: StickyActionBarProps) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-neutral-300 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-6 py-2.5">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="flex items-center gap-2 rounded-sm bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 disabled:opacity-60"
        >
          <Save className="size-4" aria-hidden />
          Сохранить
        </button>

        <button
          type="submit"
          name="intent"
          value="apply"
          disabled={pending}
          className="flex items-center gap-2 rounded-sm bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60"
        >
          <CheckCircle2 className="size-4" aria-hidden />
          Применить
        </button>

        {showPublish ? (
          <button
            type="submit"
            name="intent"
            value="publish"
            disabled={pending}
            title="Перевести материал в статус «Опубликован»"
            className="flex items-center gap-2 rounded-sm bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-60"
          >
            <Rocket className="size-4" aria-hidden />
            Опубликовать
          </button>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          title={
            dirty
              ? "Вернуть несохранённые изменения к последней сохранённой версии"
              : "Несохранённых изменений нет"
          }
          className="flex items-center gap-2 rounded-sm border border-neutral-400 bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-300 disabled:opacity-60"
        >
          <Undo2 className="size-4" aria-hidden />
          Отменить
        </button>

        {/*
          Labelled "В корзину", not "Удалить", because that is what it does: the row
          survives and can be restored from the list's second tab. An irreversible action
          wearing a recoverable label is the more dangerous of the two mistakes here.
        */}
        <button
          type="button"
          onClick={onDelete}
          disabled={pending || !canDelete}
          title={canDelete ? "Переместить материал в корзину" : "Сначала сохраните материал"}
          className="ml-auto flex items-center gap-2 rounded-sm bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-4" aria-hidden />
          В корзину
        </button>
      </div>
    </div>
  );
}