"use client";

import { Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { ENTITY_MAX_SUMMARY, cleanEntityWhitespace, slugify } from "@/lib/entity-card";
import { cn } from "@/lib/utils";

/**
 * The create/edit form for one card.
 *
 * The slug is generated from the title but stays editable, because transliteration is a
 * guess: `slugify` turns «Берёзовский» into `berezovskiy`, and an editor who knows the
 * address their readers will see should win over it. The field is therefore only filled
 * in while the editor has not touched it — overwriting a slug someone typed by hand is
 * the kind of helpfulness that loses work.
 */

export type EntityCardDraft = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  location: string;
  foundedYear: string;
  websiteUrl: string;
  images: string[];
};

/** How many pictures one card may carry — the same cap the reader-facing parse applies. */
const MAX_IMAGES = 8;

export function EntityCardEditor({
  draft,
  busy,
  fieldErrors = {},
  onCancel,
  onSave,
}: {
  draft: EntityCardDraft;
  busy: boolean;
  /** Server-side rule failures, keyed by field, shown under the offending input. */
  fieldErrors?: Record<string, string>;
  onCancel: () => void;
  onSave: (draft: EntityCardDraft) => void;
}) {
  const [values, setValues] = useState(draft);
  const [slugTouched, setSlugTouched] = useState(Boolean(draft.slug));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /*
    No effect resetting the fields when `draft` changes.
    That is what a `useEffect` doing `setValues(draft)` would be for, and it renders the
    form with the *previous* card's values for one frame before correcting — the lint rule
    about setState in an effect is pointing at that, not at taste. The caller passes a
    changing `key` instead, so React builds a fresh instance per card and the initial state
    is right on the first paint.
  */

  const set = <K extends keyof EntityCardDraft>(key: K, value: EntityCardDraft[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  /*
    Every keystroke goes through `cleanEntityWhitespace`, which only ever replaces an odd
    space with an ordinary one — never collapses runs, so the second press of the space bar
    still does something. A description pasted from Word arrives full of non-breaking spaces
    that look identical and behave differently; catching them here means the counter below
    the field is counting the text that will actually be stored, not the text as pasted.
  */
  const setText = (key: "title" | "summary" | "category" | "location") => (value: string) =>
    set(key, cleanEntityWhitespace(value));

  const summaryOver = values.summary.length > ENTITY_MAX_SUMMARY;

  // While the slug is untouched it follows the title. The comparison is against the
  // previous title, so a title edit that does not change the slug does not unstick it.
  const [lastTitle, setLastTitle] = useState(values.title);
  if (values.title !== lastTitle) {
    setLastTitle(values.title);
    if (!slugTouched) {
      setValues((current) => ({ ...current, slug: slugify(values.title) }));
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;

    const room = MAX_IMAGES - values.images.length;
    if (room <= 0) {
      setUploadError(`Не больше ${MAX_IMAGES} фотографий.`);
      return;
    }

    const batch = Array.from(files).slice(0, room);
    if (batch.length < files.length) {
      setUploadError(`Добавлены первые ${room}: это предел.`);
    }

    setUploading(true);
    setUploadError(null);

    try {
      const uploaded: string[] = [];

      // One request per file, because the upload endpoint takes a single file. Done in
      // sequence rather than all at once: the VPS has one core, and a burst of parallel
      // uploads on top of a page render is the shape of request that times out.
      for (const file of batch) {
        const body = new FormData();
        body.append("file", file);

        // The same endpoint the article cover uses: one file per request, answering
        // `{ url }`. Multipart rather than JSON, which is why the loop exists — there is
        // no batch shape on this route to use.
        const response = await fetch("/api/upload", {
          method: "POST",
          body,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = (await response.json()) as { url?: string };
        if (!payload.url) throw new Error("Сервер не вернул адрес файла");
        uploaded.push(payload.url);
      }

      setValues((current) => ({ ...current, images: [...current.images, ...uploaded] }));
    } catch {
      setUploadError("Не удалось загрузить фотографию.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10">
      <div className="w-full max-w-xl rounded-lg border border-neutral-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-800">
            {values.slug ? "Карточка объекта" : "Новая карточка"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Закрыть"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Название</span>
            <input
              value={values.title}
              onChange={(event) => setText("title")(event.target.value)}
              className={cn(
                "mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none",
                fieldErrors.title
                  ? "border-red-400 focus:border-red-500"
                  : "border-neutral-300 focus:border-neutral-500",
              )}
            />
            {fieldErrors.title ? (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.title}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Адрес карточки
            </span>
            <input
              value={values.slug}
              onChange={(event) => {
                setSlugTouched(true);
                set("slug", event.target.value);
              }}
              placeholder={slugify(values.title) || "yangantau"}
              className={cn(
                "mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none",
                fieldErrors.slug
                  ? "border-red-400 focus:border-red-500"
                  : "border-neutral-300 focus:border-neutral-500",
              )}
            />
            {fieldErrors.slug ? (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.slug}</span>
            ) : (
              <span className="mt-1 block text-xs text-neutral-400">
                Латиница, цифры и дефисы. По нему на карточку ссылаются материалы.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Категория</span>
            <input
              value={values.category}
              onChange={(event) => setText("category")(event.target.value)}
              placeholder="Экопарк, Музей, Персона"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Краткое описание
            </span>
            <textarea
              value={values.summary}
              onChange={(event) => setText("summary")(event.target.value)}
              rows={6}
              className={cn(
                "mt-1 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                summaryOver || fieldErrors.summary
                  ? "border-red-400 focus:border-red-500"
                  : "border-neutral-300 focus:border-neutral-500",
              )}
            />

            {/*
              A counter rather than a hard `maxLength`. `maxLength` would silently stop
              accepting characters at the limit, which reads as the keyboard having broken;
              a number that turns red says what is wrong and leaves the decision with the
              editor. The amber band from 90% is there so the limit is visible before it is
              hit, which is the whole point of showing a count at all.
            */}
            <span
              className={cn(
                "mt-1 flex items-center justify-between text-xs",
                summaryOver
                  ? "text-red-600"
                  : values.summary.length > ENTITY_MAX_SUMMARY * 0.9
                    ? "text-amber-600"
                    : "text-neutral-400",
              )}
            >
              <span>
                Символов: {values.summary.length} / {ENTITY_MAX_SUMMARY}
              </span>
              {summaryOver ? <span>Описание длиннее лимита.</span> : null}
            </span>

            {fieldErrors.summary && !summaryOver ? (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.summary}</span>
            ) : null}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Локация</span>
              <input
                value={values.location}
                onChange={(event) => setText("location")(event.target.value)}
                placeholder="г. Екатеринбург, ул. …"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Веха</span>
              <input
                value={values.foundedYear}
                onChange={(event) => set("foundedYear", event.target.value)}
                placeholder="1974"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Ссылка</span>
            <input
              value={values.websiteUrl}
              onChange={(event) => set("websiteUrl", event.target.value)}
              placeholder="https://example.ru"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-neutral-600">Фотографии</span>

            {values.images.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {values.images.map((image, index) => (
                  <li
                    key={image}
                    className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-1.5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt=""
                      className="size-12 shrink-0 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                      {image}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "images",
                          values.images.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={`Убрать фото ${index + 1}`}
                      className="rounded p-1 text-neutral-400 hover:text-red-600"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const next = [...values.images];
                        const target = index - 1;
                        if (target < 0) return;
                        [next[target], next[index]] = [next[index], next[target]];
                        set("images", next);
                      }}
                      disabled={index === 0}
                      aria-label="Поднять фото выше"
                      className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const next = [...values.images];
                        const target = index + 1;
                        if (target >= next.length) return;
                        [next[target], next[index]] = [next[index], next[target]];
                        set("images", next);
                      }}
                      disabled={index === values.images.length - 1}
                      aria-label="Опустить фото ниже"
                      className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => void upload(event.target.files)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || values.images.length >= MAX_IMAGES}
              className="mt-2 flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              {uploading ? "Загружаем…" : "Загрузить фото"}
            </button>

            <span className="mt-1 block text-xs text-neutral-400">
              До {MAX_IMAGES} фотографий. Порядок можно менять — он задаёт карусель в карточке.
            </span>

            {uploadError ? (
              <p className="mt-1 text-xs text-red-600">{uploadError}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onSave(values)}
            disabled={busy || uploading}
            className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-60"
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}