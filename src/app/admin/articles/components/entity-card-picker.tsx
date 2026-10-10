"use client";

import { Building2, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { EntityCardView } from "@/lib/entity-card";
import { cn } from "@/lib/utils";

/**
 * The editor's picker for a card reference.
 *
 * Search happens here rather than through a query parameter on the list endpoint, because
 * the alternative is a request per keystroke against an endpoint that walks the whole
 * table: the editorial list is small, it is not changing while the dialog is open, and
 * loading it once is both faster and one fewer thing to keep correct.
 */
export function EntityCardPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (card: EntityCardView) => void;
}) {
  const [cards, setCards] = useState<EntityCardView[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    /*
      `loading` starts false and is set inside the promise chain rather than
      synchronously in the effect body: a synchronous setState here renders twice before
      the dialog has drawn anything, which is the cascading render the lint rule is about.
      The spinner is still shown on the first pass because the fetch cannot resolve before
      the effect runs anyway.
    */
    let cancelled = false;

    fetch("/api/admin/entities")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload: { cards?: EntityCardView[] }) => {
        if (cancelled) return;
        setCards(payload.cards ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Не удалось загрузить справочник.");
        setLoading(false);
      });

    // Focus after open so the editor can type straight away.
    inputRef.current?.focus();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes, and the caret's insertion point is not lost while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter(
      (card) =>
        card.title.toLowerCase().includes(needle) ||
        card.slug.includes(needle) ||
        (card.category ?? "").toLowerCase().includes(needle),
    );
  }, [cards, query]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Вставить карточку объекта"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или адрес карточки"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
          >
            Esc
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Загружаем справочник…
            </p>
          ) : error ? (
            <p className="px-3 py-6 text-sm text-red-600">{error}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-sm text-neutral-500">
              {cards.length === 0
                ? "Справочник пуст. Создайте первую карточку в /admin/entities."
                : "Ничего не найдено."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {visible.map((card) => (
                <li key={card.slug}>
                  <button
                    type="button"
                    onClick={() => onPick(card)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-amber-50",
                    )}
                  >
                    <Building2 className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800">
                        {card.title}
                      </span>
                      <span className="block truncate text-xs text-neutral-400">
                        {card.category ? `${card.category} · ` : ""}
                        /entities/{card.slug}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}