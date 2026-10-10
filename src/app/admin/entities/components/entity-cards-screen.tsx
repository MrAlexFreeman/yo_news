"use client";

import { Building2, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EntityCardEditor, type EntityCardDraft } from "@/app/admin/entities/components/entity-card-editor";
import type { EntityCardView } from "@/lib/entity-card";
import { cn } from "@/lib/utils";

/**
 * `/admin/entities` — the reference desk.
 *
 * The list, the search, and the one form that both creates and edits. Kept as a single
 * client component rather than a server page with a route per card, because the desk is
 * small and interactive: search-as-you-type and a form that opens in place are the whole
 * interaction, and a round trip per keystroke would make it feel broken.
 */
export function EntityCardsScreen() {
  const [cards, setCards] = useState<EntityCardView[]>([]);
  const [query, setQuery] = useState("");
  /** True once a fetch has come back, successfully or not. */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Errors keyed by field, so the form can show each under its own input. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [editing, setEditing] = useState<EntityCardDraft | null>(null);
  /*
    Bumped on every open, and used as the form's `key`. That is what makes the form start
    from the card that was opened: without it the component would keep the state of the
    previous one, and correcting it after the fact would render the old card's values for a
    frame — see the note in `entity-card-editor.tsx` about why that is not done with an
    effect.
  */
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const openEditor = (draft: EntityCardDraft) => {
    setEditing(draft);
    setFormKey((current) => current + 1);
  };

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/entities");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { cards?: EntityCardView[] };
    return payload.cards ?? [];
  }, []);

  /*
    The first load, in the effect itself rather than through `load`.
    Calling a `useCallback` that contains setState is the same thing to the
    set-state-in-effect rule as writing the setState inline, and it reads worse besides:
    here the fetch and every state change it causes are next to each other.
  */
  useEffect(() => {
    let cancelled = false;

    load()
      .then((loadedCards) => {
        if (cancelled) return;
        setCards(loadedCards);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Не удалось загрузить справочник.");
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Re-reads the list after a write, reporting a failure in place. */
  async function reload() {
    try {
      setCards(await load());
    } catch {
      setError("Не удалось обновить справочник.");
    }
  }

  const visible = cards.filter((card) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      card.title.toLowerCase().includes(needle) ||
      card.slug.includes(needle) ||
      (card.category ?? "").toLowerCase().includes(needle)
    );
  });

  async function save(draft: EntityCardDraft) {
    setBusy(true);
    try {
      /*
        `from` is the address the card was opened under, `slug` is where it is going —
        two fields, because the address is editable and an editor correcting a
        transliteration expects the card to move rather than to be refused.
      */
      const previous = editing?.slug;

      const response = await fetch("/api/admin/entities", {
        method: previous ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previous ? { ...draft, from: previous } : draft),
      });

      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: string;
          fieldErrors?: Record<string, string>;
        };
        /*
          Both, not one or the other. The panel above the form carries the first message as a
          summary, and the same errors go down to the form so each lands under the field it is
          about — an editor told «Не длиннее 3000 символов» with nothing saying which field is
          being addressed has to guess.
        */
        setFieldErrors(payload.fieldErrors ?? {});
        throw new Error(
          payload.fieldErrors
            ? Object.values(payload.fieldErrors)[0]
            : payload.error ?? "Не удалось сохранить.",
        );
      }

      setFieldErrors({});
      setEditing(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: EntityCardView) {
    const confirmed = window.confirm(
      `Удалить карточку «${card.title}»? Материалы, которые на неё ссылаются, сохранят ссылку.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const response = await fetch("/api/admin/entities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: card.slug }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Не удалось удалить.");
      }

      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-800">Карточки объектов</h1>
        <button
          type="button"
          onClick={() => openEditor({ slug: "", title: "", summary: "", category: "", location: "", foundedYear: "", websiteUrl: "", images: [] })}
          className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          <Plus className="size-4" aria-hidden />
          Создать карточку
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2">
        <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по названию, адресу или категории"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            Сбросить
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!loaded ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Загружаем справочник…
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          {cards.length === 0
            ? "Справочник пуст. Создайте первую карточку — например, о месте или человеке, о котором часто пишете."
            : "Ничего не найдено."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
          {visible.map((card) => (
            <li
              key={card.slug}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <Building2 className="size-4 shrink-0 text-amber-600" aria-hidden />

              <button
                type="button"
                onClick={() =>
                  openEditor({
                    slug: card.slug,
                    title: card.title,
                    summary: card.summary,
                    category: card.category ?? "",
                    location: card.location ?? "",
                    foundedYear: card.foundedYear ?? "",
                    websiteUrl: card.websiteUrl ?? "",
                    images: card.images,
                  })
                }
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-neutral-800">
                  {card.title}
                </span>
                <span className="block truncate text-xs text-neutral-400">
                  {card.category ? `${card.category} · ` : ""}/entities/{card.slug}
                  {card.images.length > 0 ? ` · фото: ${card.images.length}` : ""}
                </span>
              </button>

              <button
                type="button"
                onClick={() => remove(card)}
                disabled={busy}
                aria-label={`Удалить карточку ${card.title}`}
                className={cn(
                  "rounded p-1.5 text-neutral-400 transition-colors hover:text-red-600",
                  busy && "opacity-50",
                )}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <EntityCardEditor
          key={formKey}
          draft={editing}
          busy={busy}
          fieldErrors={fieldErrors}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}