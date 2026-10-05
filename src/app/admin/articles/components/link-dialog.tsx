"use client";

import { Check, Link as LinkIcon, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MIN_QUERY_LENGTH, articlePath } from "@/lib/article-search";

type Hit = { id: string; title: string; slug: string; publishedAt: string | null };

export type LinkRequest = {
  label: string;
  url: string;
  blank: boolean;
};

type LinkDialogProps = {
  /** Text the editor had selected when the dialog opened. */
  initialLabel: string;
  onApply: (result: LinkRequest) => void;
  onClose: () => void;
};

const DEBOUNCE_MS = 300;

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Schemes accepted in the URL field.
 *
 * Mirrors what the article sanitiser will allow, so the dialog refuses a
 * `javascript:` URL here instead of letting the editor save a link that later
 * renders with no href and no explanation.
 */
const SAFE_URL = /^(?:https?:\/\/|\/|#|mailto:|tel:)/i;

type SearchStatus =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "done"; hits: Hit[] }
  | { kind: "empty" }
  | { kind: "failed" };

/**
 * "Вставить ссылку" dialog, with a search over stories already published.
 *
 * The search is the part editors actually reach for: most internal links point at
 * another article on the same site, and copying its slug out of the address bar was
 * the tedious step this removes.
 */
export function LinkDialog({ initialLabel, onApply, onClose }: LinkDialogProps) {
  const headingId = useId();
  const labelId = useId();
  const urlId = useId();
  const searchId = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const [label, setLabel] = useState(initialLabel);
  const [url, setUrl] = useState("");
  const [blank, setBlank] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });

  // Focus lands on whichever field the editor will fill first: the label when they
  // had text selected, the URL when they did not.
  useEffect(() => {
    (initialLabel ? labelRef.current : urlRef.current)?.focus();
  }, [initialLabel]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only the newest request may write results. A slow response for "тран" landing
  // after a fast one for "транспорт" is the classic type-ahead race, and it shows
  // up as the list flickering back to the older, worse matches.
  const requestToken = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    requestToken.current += 1;
    const token = requestToken.current;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < MIN_QUERY_LENGTH) {
      setStatus({ kind: "idle" });
      return;
    }

    setStatus({ kind: "searching" });
    debounceRef.current = setTimeout(() => {
      fetch(`/api/admin/articles-search?q=${encodeURIComponent(value.trim())}`)
        .then((response) => {
          if (!response.ok) throw new Error("search failed");
          return response.json() as Promise<{ results?: Hit[] }>;
        })
        .then((payload) => {
          if (requestToken.current !== token) return;
          const hits = payload.results ?? [];
          setStatus(hits.length > 0 ? { kind: "done", hits } : { kind: "empty" });
        })
        .catch(() => {
          if (requestToken.current === token) setStatus({ kind: "failed" });
        });
    }, DEBOUNCE_MS);
  }

  /** Clicking a hit fills the URL with the site-relative path. */
  function pickHit(hit: Hit) {
    setUrl(articlePath(hit.slug));
    setError(null);
    urlRef.current?.focus();
  }

  function apply() {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setError("Укажите адрес ссылки или выберите новость из списка.");
      urlRef.current?.focus();
      return;
    }

    if (!SAFE_URL.test(trimmedUrl)) {
      setError(
        "Адрес должен начинаться с https://, http://, mailto: или / — например /news/статья.",
      );
      urlRef.current?.focus();
      return;
    }

    onApply({ label: trimmedLabel || trimmedUrl, url: trimmedUrl, blank });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        // Backdrop click dismisses. A drag that started inside the dialog and ended
        // outside it must not close the thing the editor is typing in — hence the
        // target check rather than a bare onClick.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-lg rounded-md border border-neutral-300 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2
            id={headingId}
            className="flex items-center gap-2 text-sm font-semibold text-neutral-900"
          >
            <LinkIcon className="size-4" aria-hidden />
            Вставить ссылку
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="space-y-1.5">
            <label htmlFor={labelId} className="text-xs font-medium text-neutral-700">
              Текст ссылки
            </label>
            <input
              ref={labelRef}
              id={labelId}
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="текст ссылки"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={urlId} className="text-xs font-medium text-neutral-700">
              URL
            </label>
            <input
              ref={urlRef}
              id={urlId}
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
              placeholder="https://eartnews.ru/… или https://…"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={blank}
              onChange={(event) => setBlank(event.target.checked)}
              className="size-4 rounded-sm border-neutral-400 accent-blue-700"
            />
            Открывать в новой вкладке
          </label>

          <div className="space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-2">
            <label
              htmlFor={searchId}
              className="flex items-center gap-1.5 text-xs font-medium text-neutral-700"
            >
              <Search className="size-3.5" aria-hidden />
              Найти новость на сайте
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Начните вводить заголовок…"
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
            />

            <div aria-live="polite" className="min-h-8">
              {status.kind === "searching" ? (
                <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-neutral-500">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Ищем…
                </p>
              ) : null}

              {status.kind === "empty" ? (
                <p className="px-1 py-1 text-xs text-neutral-500">
                  Ничего не найдено среди опубликованных.
                </p>
              ) : null}

              {status.kind === "failed" ? (
                <p className="px-1 py-1 text-xs text-red-600">
                  Поиск недоступен — вставьте адрес вручную.
                </p>
              ) : null}

              {status.kind === "done" ? (
                <ul className="max-h-48 divide-y divide-neutral-200 overflow-y-auto">
                  {status.hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => pickHit(hit)}
                        className="block w-full px-1 py-1.5 text-left hover:bg-white"
                      >
                        <span className="block truncate text-xs font-medium text-neutral-800">
                          {hit.title}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-neutral-400">
                          {articlePath(hit.slug)}
                          {hit.publishedAt
                            ? ` · ${DATE_FORMAT.format(new Date(hit.publishedAt))}`
                            : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900"
          >
            <Check className="size-4" aria-hidden />
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The markup the dialog produces.
 *
 * `target="_self"` rather than omitting the attribute when the box is unchecked:
 * the site applies `_blank` as its default for a link that expresses no
 * preference, so "same tab" has to be stated explicitly for the checkbox to
 * actually mean something.
 */
export function buildLinkMarkup(input: LinkRequest): string {
  const href = input.url.replace(/"/g, "&quot;");
  const target = input.blank ? "_blank" : "_self";
  const rel = input.blank ? ' rel="noopener noreferrer"' : "";

  return `<a href="${href}" target="${target}"${rel}>${input.label}</a>`;
}