"use client";

import { CheckCircle2, Save, Trash2, Undo2 } from "lucide-react";

type StickyActionBarProps = {
  pending: boolean;
  /** Deletion needs a persisted record; a brand new article has none yet. */
  canDelete: boolean;
  onCancel: () => void;
  onDelete: () => void;
};

/**
 * Full-width sticky footer with the four editorial actions. Mirrors the
 * mk.ru editor: save leaves the page, apply stays, cancel reverts, delete is
 * parked on the right.
 */
export function StickyActionBar({
  pending,
  canDelete,
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

        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex items-center gap-2 rounded-sm border border-neutral-400 bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-300 disabled:opacity-60"
        >
          <Undo2 className="size-4" aria-hidden />
          Отменить
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={pending || !canDelete}
          title={canDelete ? "Удалить материал" : "Сначала сохраните материал"}
          className="ml-auto flex items-center gap-2 rounded-sm bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-4" aria-hidden />
          Удалить
        </button>
      </div>
    </div>
  );
}
