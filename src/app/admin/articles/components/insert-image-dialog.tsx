"use client";

import { Check, ImageUp, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { collectArticleImages, imageLabel } from "@/lib/article-images";
import type { MediaItem } from "@/lib/article-media";
import { cn } from "@/lib/utils";

/**
 * "Вставить фото в текст".
 *
 * Two ways in, in this order on purpose: uploading a new file is the common case for a
 * story being written, and picking from what is already in the article is the case that
 * saves a re-upload when a picture is being moved from the gallery into the body.
 *
 * The file goes to the same endpoint the cover upload uses, so there is one upload path
 * with one set of limits rather than a second one that drifts. What comes back is a
 * `/uploads/…` URL, which is what gets stored.
 */

type InsertImageDialogProps = {
  /** Body HTML, so pictures already placed in the text can be offered. */
  html: string;
  media: MediaItem[];
  coverImage: string;
  onInsert: (input: { src: string; alt: string; caption: string }) => void;
  onClose: () => void;
};

export function InsertImageDialog({
  html,
  media,
  coverImage,
  onInsert,
  onClose,
}: InsertImageDialogProps) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = collectArticleImages({ html, media, coverImage });

  async function upload(file: File) {
    setUploading(true);
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/upload", { method: "POST", body });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Не удалось загрузить файл.");
      }

      setSrc(payload.url);
      // The filename is a UUID, so it makes a poor default alt text; the caption the
      // editor is about to write is a better one, but only once they have written it.
      if (!alt) setAlt("");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(false);
    }
  }

  function canInsert() {
    return Boolean(src.trim()) && !uploading;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Вставить фото в текст"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="my-8 w-full max-w-2xl rounded border border-neutral-300 bg-white shadow-lg">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Вставить фото в текст
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {/* --- загрузка нового файла ------------------------------------- */}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded border-2 border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-blue-500 bg-blue-50" : "border-neutral-300 bg-neutral-50",
            )}
          >
            <ImageUp className="size-6 text-neutral-400" aria-hidden />
            <p className="text-sm text-neutral-600">
              Перетащите файл сюда или выберите на компьютере
            </p>
            <p className="text-xs text-neutral-400">JPG, PNG или WebP, до 8 МБ</p>

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="mt-1 flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              {uploading ? "Загрузка…" : "Выбрать файл"}
            </button>

            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so choosing the same file twice fires again.
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          {/* --- выбранная картинка и подпись ------------------------------ */}
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="flex h-28 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-neutral-50">
              {src ? (
                // The file is on this server and is already the size it will be shown
                // at; next/image would add an optimiser round trip to an admin preview.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="px-2 text-center text-xs text-neutral-400">
                  Файл ещё не выбран
                </span>
              )}
            </div>

            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">Подпись к фото</span>
                <input
                  type="text"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="Необязательно"
                  className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">
                  Alt-текст (для доступности и поиска)
                </span>
                <input
                  type="text"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  placeholder="Что на фотографии"
                  className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                />
              </label>
            </div>
          </div>

          {/* --- уже загруженные в статью --------------------------------- */}
          {existing.length > 0 ? (
            <div className="space-y-2 border-t border-neutral-200 pt-3">
              <p className="text-xs font-medium text-neutral-600">
                Уже есть в статье — нажмите, чтобы подставить
              </p>
              <div className="flex flex-wrap gap-2">
                {existing.map((image) => {
                  const active = src === image.url;
                  return (
                    <button
                      key={image.url}
                      type="button"
                      onClick={() => setSrc(image.url)}
                      title={imageLabel(image)}
                      aria-pressed={active}
                      className={cn(
                        "relative size-16 overflow-hidden rounded border-2 transition-colors",
                        active ? "border-blue-500" : "border-neutral-200 hover:border-neutral-400",
                      )}
                    >
                      {/* Same reason as the preview above: an admin thumbnail. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={imageLabel(image)}
                        className="size-full object-cover"
                      />
                      {active ? (
                        <span className="absolute right-0 bottom-0 bg-blue-500 p-0.5 text-white">
                          <Check className="size-3" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canInsert()) return;
              onInsert({ src: src.trim(), alt: alt.trim(), caption });
            }}
            disabled={!canInsert()}
            className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-50"
          >
            <ImageUp className="size-4" aria-hidden />
            Вставить в текст
          </button>
        </footer>
      </div>
    </div>
  );
}
