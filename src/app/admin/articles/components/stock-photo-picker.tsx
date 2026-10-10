"use client";

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { keywordsFromTitle, type StockPhoto } from "@/lib/unsplash";
import { cn } from "@/lib/utils";

/**
 * «Подобрать на стоках» — pick a photograph from Unsplash as the article's cover.
 *
 * **The search runs on a button, not on every keystroke.** Unsplash allows fifty API calls
 * an hour and the counter is shared with the download step, so searching as the editor
 * types would spend the whole budget on one article and leave the button dead for the rest
 * of the hour with an error nobody can act on. The field here is a query to run, not a live
 * filter, and it says so.
 *
 * The title seeds the field rather than firing a request: the keywords are a guess, and
 * showing them lets the editor correct the guess before paying for it.
 */

export type StockPhotoChosen = {
  url: string;
  credit: string;
  stock: {
    photoId: string;
    authorName: string;
    authorUrl: string;
    photoUrl: string;
  };
};

type SearchResponse = {
  photos?: StockPhoto[];
  total?: number;
  remaining?: number | null;
  limit?: number;
  error?: string;
};

export function StockPhotoPicker({
  open,
  title,
  onClose,
  onPicked,
}: {
  open: boolean;
  /** The article's title, used to seed the query. */
  title: string;
  onClose: () => void;
  onPicked: (chosen: StockPhotoChosen) => void;
}) {
  /*
    No effect resetting the fields when the dialog opens.

    This component returns `null` while closed, so it already unmounts between uses and
    mounts fresh with its initial state — a `useEffect` doing `setQuery(...)` here would be
    correcting state that is already correct, after a render that showed the old query.
    Seeding through `useState`'s lazy initialiser is the same thing without the frame.
  */
  const [query, setQuery] = useState(() => keywordsFromTitle(title));
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
    Results accumulate across pages: "показать ещё" appends rather than replaces, so the
    editor can compare page two against page one instead of losing the choice they were
    about to make.
  */
  const runSearch = useCallback(async (term: string, nextPage: number, append: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/articles/stock-search?q=${encodeURIComponent(term)}&page=${nextPage}`,
      );
      const payload = (await response.json()) as SearchResponse;

      if (!response.ok) {
        setError(payload.error ?? "Не удалось найти фотографии.");
        setLoading(false);
        return;
      }

      const found = payload.photos ?? [];
      setPhotos((current) => (append ? [...current, ...found] : found));
      setTotal(payload.total ?? 0);
      if (typeof payload.remaining === "number") setRemaining(payload.remaining);
      if (typeof payload.limit === "number") setLimit(payload.limit);
      setPage(nextPage);
      setSearched(true);
    } catch {
      setError("Не удалось обратиться к Unsplash.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus once mounted, so the editor can type straight away.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function download(photo: StockPhoto) {
    setDownloading(photo.id);
    setError(null);

    try {
      const response = await fetch("/api/admin/articles/stock-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the id. The address the server downloads from is read back from Unsplash,
        // so nothing the browser holds can point it at a third-party host.
        body: JSON.stringify({ photoId: photo.id }),
      });
      const payload = (await response.json()) as StockPhotoChosen & { error?: string };

      if (!response.ok || !payload.url) {
        setError(payload.error ?? "Не удалось загрузить фотографию.");
        return;
      }

      onPicked(payload);
      onClose();
    } catch {
      setError("Не удалось загрузить фотографию.");
    } finally {
      setDownloading(null);
    }
  }

  const exhausted = remaining !== null && remaining <= 0;
  const canShowMore = photos.length > 0 && photos.length < total && !exhausted && !loading;

  return (
    <div
      role="dialog"
      aria-label="Подобрать фото на стоках"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter runs the search, which is what makes this a query and not a filter.
              if (event.key === "Enter" && query.trim()) void runSearch(query, 1, false);
            }}
            placeholder="Что ищем? Например: экологический парк екатеринбург"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void runSearch(query, 1, false)}
            disabled={loading || !query.trim() || exhausted}
            className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Найти
          </button>
        </div>

        <div className="px-3 py-2 text-[11px] text-neutral-400">
          {exhausted
            ? "Часовой лимит Unsplash исчерпан — поиск вернётся через час."
            : remaining !== null
              ? `Осталось запросов в этом часу: ${remaining} из ${limit}. Поиск — по кнопке, не по каждой букве.`
              : `Бесплатный план Unsplash: ${limit} запросов в час. Поиск — по кнопке.`}
        </div>

        {error ? (
          <p role="alert" className="mx-3 mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="max-h-[26rem] overflow-y-auto px-3 pb-3">
          {photos.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {searched
                ? "Ничего не нашлось. Попробуйте другие слова — поиск идёт по описанию снимка на английском."
                : "Введите запрос и нажмите «Найти». Ключевые слова подставлены из заголовка."}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-3">
              {photos.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => void download(photo)}
                    disabled={downloading !== null || exhausted}
                    className={cn(
                      "group block w-full overflow-hidden rounded-md border border-neutral-200 bg-white text-left transition-colors",
                      "hover:border-amber-500 disabled:opacity-60",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={photo.description}
                      loading="lazy"
                      className="aspect-[3/2] w-full bg-neutral-100 object-cover"
                    />
                    <span className="block px-2 py-2">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium text-neutral-800">
                          {photo.authorName}
                        </span>
                        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                          Unsplash
                        </span>
                      </span>
                      {photo.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-neutral-400">
                          {photo.description}
                        </span>
                      ) : null}
                      {downloading === photo.id ? (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                          Загружаем…
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {photos.length > 0 ? (
          <div className="border-t border-neutral-200 px-3 py-2 text-center">
            {canShowMore ? (
              <button
                type="button"
                onClick={() => void runSearch(query, page + 1, true)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Показать ещё
              </button>
            ) : exhausted ? (
              <p className="text-[11px] text-amber-700">
                Больше нельзя до конца часа — лимит Unsplash исчерпан.
              </p>
            ) : (
              <p className="text-[11px] text-neutral-400">
                Показаны все {total} {total === 1 ? "снимок" : "снимка"}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}