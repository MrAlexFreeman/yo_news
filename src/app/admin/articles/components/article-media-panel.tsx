"use client";

import { Eye, ImagePlus, Loader2, MousePointerClick, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import {
  MAX_MEDIA_ITEMS,
  MEDIA_ACCEPT_ATTRIBUTE,
  looksLikeVideo,
  mediaFileProblem,
  type MediaItem,
} from "@/lib/article-media";
import { readImageDimensions } from "@/lib/image-dimensions";
import { cn } from "@/lib/utils";

/**
 * «Медиафайлы статьи» — the compact grid in the article's sidebar.
 *
 * It is a *view of the same gallery* the «Медиа» tab edits in detail, not a second
 * list. One source of truth matters here more than it looks: two lists of "the
 * article's pictures" would drift the moment somebody uploaded from one of them, and
 * neither would be wrong enough to be noticed — the RSS feed reads the gallery, the
 * body reads the figure, and a picture present in one and missing from the other
 * produces an article that looks complete in the editor and is missing a photo on the
 * Dzen card.
 *
 * The whole point of the grid is the click: pick a picture, put it where the caret is.
 * Preview and delete are small overlays rather than separate rows, because the list of
 * thumbnails is the thing an editor scans.
 */

type ArticleMediaPanelProps = {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  /** Called when a thumbnail is clicked; inserts the picture into the body. */
  onInsert: (item: MediaItem) => void;
  /** Where the caret is, so the hint can say what a click will do. */
  insertHint: string;
};

export function ArticleMediaPanel({
  items,
  onChange,
  onInsert,
  insertHint,
}: ArticleMediaPanelProps) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | File[]) {
    const queue = [...files].filter((file) => !looksLikeVideo(file));
    const refused = [...files].filter(looksLikeVideo);
    if (queue.length === 0) {
      setErrors(
        refused.length > 0
          ? ["Видео добавляется ссылкой, а не файлом: см. поле «Ссылка на видео»."]
          : [],
      );
      return;
    }

    setErrors([]);
    setBusy(true);

    const problems: string[] = [];
    let added = [...items];

    for (const file of queue) {
      const problem = mediaFileProblem(file, added.length);
      if (problem) {
        problems.push(problem);
        if (added.length >= MAX_MEDIA_ITEMS) break;
        continue;
      }

      try {
        const dimensions = await readImageDimensions(file);
        const body = new FormData();
        body.append("file", file);

        const response = await fetch("/api/upload", { method: "POST", body });
        const payload = (await response.json()) as { url?: string; error?: string };

        if (!response.ok || !payload.url) {
          problems.push(`${file.name}: ${payload.error ?? "загрузка не удалась"}`);
          continue;
        }

        added = [
          ...added,
          {
            url: payload.url,
            caption: "",
            source: "",
            width: dimensions.width,
            height: dimensions.height,
          },
        ];
        onChange(added);
      } catch (error) {
        problems.push(
          `${file.name}: ${error instanceof Error ? error.message : "ошибка загрузки"}`,
        );
      }
    }

    setErrors(problems);
    setBusy(false);
  }

  return (
    <section className="rounded border border-neutral-300 bg-white shadow-xs">
      <h2 className="rounded-t border-b border-neutral-300 bg-gradient-to-b from-neutral-100 to-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800">
        Медиафайлы статьи
      </h2>

      <div className="space-y-2 p-3">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
          }}
          className={cn(
            "rounded border border-dashed px-2 py-3 text-center transition-colors",
            dragging ? "border-yo bg-yo/5" : "border-neutral-300 bg-neutral-50",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={MEDIA_ACCEPT_ATTRIBUTE}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void uploadFiles(event.target.files);
              // Reset so re-picking the same files fires change again.
              event.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || items.length >= MAX_MEDIA_ITEMS}
            className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-3.5" aria-hidden />
            )}
            {busy ? "Загружаем…" : "Добавить фото"}
          </button>

          <p className="mt-1 text-[11px] text-neutral-400">
            {items.length} из {MAX_MEDIA_ITEMS}. Перетащите пачку сюда.
          </p>
        </div>

        {errors.length > 0 ? (
          <ul role="alert" className="space-y-1 rounded border border-red-200 bg-red-50 p-2">
            {errors.map((message) => (
              <li key={message} className="text-[11px] text-red-700">
                {message}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          The hint states what a click will do before it is clicked, because the two
          outcomes differ and the editor has no way to see which one applies: with the
          caret placed the picture lands there, without it the picture goes to the end.
          Saying so in advance is cheaper than an undo.
        */}
        <p className="text-[11px] text-neutral-500">{insertHint}</p>

        {items.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2">
            {items.map((item, index) => (
              <li key={item.url} className="group relative aspect-square">
                {/*
                  One button per thumbnail, and the overlays are siblings rather than
                  children: a button inside a button is invalid HTML and browsers
                  disagree about which one a click belongs to.
                */}
                <button
                  type="button"
                  onClick={() => onInsert(item)}
                  title="Вставить в текст"
                  aria-label={`Вставить в текст фото ${index + 1}${item.caption ? `: ${item.caption}` : ""}`}
                  className="size-full overflow-hidden rounded border border-neutral-200 transition-colors hover:border-yo focus-visible:border-yo focus-visible:outline-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a sidebar
                      thumbnail of a file this server already stores; next/image would
                      add an optimiser round trip per thumbnail. */}
                  <img
                    src={item.url}
                    alt={item.caption}
                    className="size-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <MousePointerClick className="size-3" aria-hidden />
                    в текст
                  </span>
                </button>

                <div className="absolute top-0.5 right-0.5 flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => setPreview(item)}
                    title="Предпросмотр"
                    aria-label={`Предпросмотр фото ${index + 1}`}
                    className="rounded bg-white/90 p-0.5 text-neutral-600 shadow-xs transition-colors hover:bg-white hover:text-neutral-900"
                  >
                    <Eye className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                    title="Убрать из статьи"
                    aria-label={`Убрать изображение ${index + 1}`}
                    className="rounded bg-white/90 p-0.5 text-neutral-600 shadow-xs transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-dashed border-neutral-300 p-3 text-center text-[11px] text-neutral-400">
            Дополнительных фото нет.
          </p>
        )}

        <p className="text-[11px] text-neutral-400">
          Эти же файлы видны на вкладке «Медиа», где к ним можно добавить подпись и
          источник для RSS-ленты.
        </p>
      </div>

      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Предпросмотр изображения"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded border border-neutral-300 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-neutral-800">Предпросмотр</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Закрыть предпросмотр"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element -- a full-size
                look at the stored file, not a page image. */}
            <img
              src={preview.url}
              alt={preview.caption}
              className="mx-auto mt-2 max-h-[70vh] w-auto rounded"
            />

            <p className="mt-2 text-center text-xs text-neutral-500">
              {preview.caption || "Подписи нет"}
              {preview.source ? ` — ${preview.source}` : ""}
            </p>
            {preview.width > 0 && preview.height > 0 ? (
              <p className="text-center text-[11px] text-neutral-400">
                {preview.width}×{preview.height}
              </p>
            ) : null}

            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  onInsert(preview);
                  setPreview(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-900"
              >
                <MousePointerClick className="size-4" aria-hidden />
                Вставить в текст
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
