"use client";

import { Loader2, Newspaper, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The editor's picker for a "read also" plate.
 *
 * Search goes through `/api/admin/articles-search` rather than loading everything once, the
 * way the entity picker does. The difference is the size of the collection: an entity
 * reference holds a few dozen cards, a newsroom holds hundreds of published stories and
 * keeps growing, so "load it all and filter in the browser" stops being reasonable long
 * before anyone notices. The endpoint already exists for the link dialog and is bounded by
 * `SEARCH_TAKE`.
 *
 * Each row carries its cover, because the plate shows one and offering a story the editor
 * cannot picture is offering something the page may not be able to render either.
 */

/** One row from the search endpoint, as this dialog needs it. */
export type ReadAlsoChoice = {
  slug: string;
  title: string;
  coverImage: string | null;
  category: { name: string; slug: string } | null;
};

type SearchResponse = {
  results?: Array<
    ReadAlsoChoice & { id: string; publishedAt: string | null }
  >;
};

/**
 * How long to wait after the last keystroke before asking.
 *
 * Longer than a link dialog's, because a plate is chosen by reading headlines rather than
 * by recognising one: the editor is scanning a list, and a request per keystroke would
 * reshuffle it under them.
 */
const SEARCH_DEBOUNCE_MS = 250;

/** Below this the endpoint refuses to search at all, so nothing is sent. */
const MIN_QUERY = 2;

export function ReadAlsoPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (choice: ReadAlsoChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadAlsoChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus after open so the editor can type straight away.
    inputRef.current?.focus();

    // Escape closes, and the caret's insertion point is not lost while it is open.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const needle = query.trim();

    // Nothing to ask for: the endpoint refuses a query this short anyway. No state is
    // reset here — the render decides what to show from `tooShort`, so clearing the list is
    // something the next keystroke or the next result causes, not a setState in the middle
    // of an effect.
    if (needle.length < MIN_QUERY) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/admin/articles-search?q=${encodeURIComponent(needle)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((payload: SearchResponse) => {
          if (cancelled) return;
          setResults(payload.results ?? []);
          setError(null);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setError("Не удалось найти материалы.");
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  /*
    The states the list can be in, in the order the reader should meet them.

    Derived rather than stored, so that shortening the query back below the minimum does
    not have to clear a list it is not going to show — the states a setState-on-effect would
    have to push back through are the ones this reads instead.
  */
  const needle = query.trim();
  const tooShort = needle.length < MIN_QUERY;
  const showHint = tooShort || (!loading && !error && results.length === 0);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Вставить «Читайте также»"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Заголовок материала"
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

        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p className="px-3 py-6 text-sm text-red-600">{error}</p>
          ) : loading ? (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Ищем…
            </p>
          ) : showHint ? (
            <p className="px-3 py-6 text-sm text-neutral-500">
              {tooShort
                ? `Введите не меньше ${MIN_QUERY} символов.`
                : "Ничего не найдено. Ищутся только опубликованные материалы."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {results.map((story) => (
                <li key={story.slug}>
                  <button
                    type="button"
                    onClick={() => onPick(story)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-amber-50"
                  >
                    {story.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={story.coverImage}
                        alt=""
                        loading="lazy"
                        width={72}
                        height={48}
                        className="h-12 w-[72px] shrink-0 rounded object-cover"
                      />
                    ) : (
                      // A placeholder of the same shape rather than nothing: a row that
                      // jumps in width as results load reads as a different list.
                      <span
                        aria-hidden
                        className="h-12 w-[72px] shrink-0 rounded bg-neutral-100"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-neutral-800">
                        {story.title}
                      </span>
                      <span className="block truncate text-xs text-neutral-400">
                        {story.category ? `${story.category.name} · ` : ""}
                        /news/{story.slug}
                      </span>
                    </span>
                    <Newspaper className="size-4 shrink-0 text-amber-600" aria-hidden />
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