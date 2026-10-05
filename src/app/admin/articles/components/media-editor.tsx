"use client";

import { GripVertical, ImagePlus, Loader2, Upload, VideoOff, X } from "lucide-react";
import { useRef, useState } from "react";

import type { MediaItem } from "@/lib/article-media";
import { DZEN_MIN_HEIGHT, DZEN_MIN_WIDTH, MAX_MEDIA_ITEMS } from "@/lib/article-media";
import { readImageDimensions } from "@/lib/image-dimensions";
import { cn } from "@/lib/utils";

type MediaEditorProps = {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
};

/** Same ceiling the upload endpoint enforces, per file. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/gif";

/**
 * The drop-zone guard message, worded as editorial asked for.
 *
 * Video goes into a link rather than onto the disk, and the reason is stated in
 * the dialog: a single 4K clip is a few hundred megabytes on a 709 MB VPS whose
 * swap file is already part of its memory budget.
 */
export const VIDEO_DROP_WARNING =
  "Для экономии диска сервера видео добавляется ссылкой (VK Video, Rutube, YouTube) в поле «Ссылка на видео». Загрузите ролик в ВК/Дзен и скопируйте ссылку сюда";

/** Extensions a press drop plausibly contains when someone grabs a video. */
const VIDEO_EXTENSIONS = [
  ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".wmv", ".flv", ".mpeg", ".mpg", ".3gp",
];

/** Container-agnostic sniffing, so a dropped file with no extension is still caught. */
const VIDEO_MIME_PREFIX = "video/";

/**
 * True for anything that looks like a video rather than a photograph.
 *
 * Exported for the test suite: this is the rule that decides whether a press drop
 * of twenty frames plus one stray clip warns or silently uploads.
 */
export function looksLikeVideo(file: Pick<File, "name" | "type">): boolean {
  if (file.type?.startsWith(VIDEO_MIME_PREFIX)) return true;
  // Some desktops report an empty type for .mkv and .mov over RDP or from a
  // network share, so the extension is the second line rather than the first.
  return VIDEO_EXTENSIONS.some((extension) =>
    file.name.toLowerCase().endsWith(extension),
  );
}

/**
 * Bulk gallery uploader for press-service photo drops.
 *
 * Uploads one file per request rather than a multipart batch: the existing
 * endpoint already enforces the type, the size cap and the UUID naming, and
 * duplicating that logic in a second code path is how the two drift apart. The
 * queue is sequential on purpose — a press drop of twenty frames would otherwise
 * open twenty parallel requests at a 709 MB VPS.
 *
 * Intrinsic dimensions are read in the browser and stored, because the RSS feed
 * has to drop anything below Dzen's 480x320 and a feed build cannot cheaply parse
 * a JPEG header to find out.
 */
export function MediaEditor({ items, onChange }: MediaEditorProps) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  /** Names of the video files refused by the drop zone, or null when no dialog. */
  const [videoWarning, setVideoWarning] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(index: number, changes: Partial<MediaItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  /** Moves an item by one slot; buttons rather than drag, so it works on touch. */
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  async function uploadFiles(files: FileList | File[]) {
    const dropped = [...files];

    // Checked before anything else: a dropped .mp4 must not start uploading, and
    // must not be allowed to fail as an unsupported image either. Both outcomes
    // tell the editor the wrong thing about what the gallery is for.
    const videos = dropped.filter(looksLikeVideo);
    if (videos.length > 0) {
      setVideoWarning(videos.map((file) => file.name));
      // The images in the same drop still go through — someone grabbing a
      // selection of twenty frames can easily clip a stray clip with them.
      const imagesOnly = dropped.filter((file) => !videos.includes(file));
      if (imagesOnly.length === 0) return;
      dropped.splice(0, dropped.length, ...imagesOnly);
    }

    const queue = dropped.filter((file) => !items.some((i) => i.url === file.name));
    if (queue.length === 0) return;

    setErrors([]);
    setBusy(true);

    const problems: string[] = [];

    for (const file of queue) {
      if (items.length >= MAX_MEDIA_ITEMS) {
        problems.push(`Достигнут предел в ${MAX_MEDIA_ITEMS} изображений.`);
        break;
      }

      if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
        problems.push(`${file.name}: нужен JPG, PNG или GIF.`);
        continue;
      }

      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name}: больше 8 МБ.`);
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

        onChange([
          ...items,
          {
            url: payload.url,
            caption: "",
            source: "",
            width: dimensions.width,
            height: dimensions.height,
          },
        ]);
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
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-neutral-700">
          Галерея: дополнительные фото
        </span>
        <span className="text-xs text-neutral-400">
          {items.length} из {MAX_MEDIA_ITEMS}
        </span>
      </div>

      {/* Drop zone. Also reachable by keyboard through the button below it, so
          it is a label rather than a drag-only target. */}
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
          "rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-yo bg-yo/5" : "border-neutral-300 bg-neutral-50",
        )}
      >
        <ImagePlus className="mx-auto size-6 text-neutral-400" aria-hidden />
        <p className="mt-2 text-sm text-neutral-600">
          Перетащите сюда пачку фото с пресс-службы
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          JPG, PNG или GIF, до 8 МБ каждое. Для RSS-ленты нужно не меньше{" "}
          {DZEN_MIN_WIDTH}×{DZEN_MIN_HEIGHT}.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
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
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {busy ? "Загружаем…" : "Выбрать файлы"}
        </button>
      </div>

      {errors.length > 0 ? (
        <ul role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2">
          {errors.map((message) => (
            <li key={message} className="text-xs text-red-700">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length === 0 ? null : (
        <ul className="space-y-2">
          {items.map((item, index) => {
            const tooSmall =
              item.width > 0 &&
              item.height > 0 &&
              (item.width < DZEN_MIN_WIDTH || item.height < DZEN_MIN_HEIGHT);

            return (
              <li
                key={item.url}
                className="flex gap-3 rounded-md border border-neutral-200 bg-white p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt=""
                  className="size-20 shrink-0 rounded border border-neutral-200 object-cover"
                />

                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    type="text"
                    value={item.caption}
                    onChange={(event) => patch(index, { caption: event.target.value })}
                    placeholder="Подпись"
                    aria-label={`Подпись к изображению ${index + 1}`}
                    className="w-full rounded-sm border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                  />
                  <input
                    type="text"
                    value={item.source}
                    onChange={(event) => patch(index, { source: event.target.value })}
                    placeholder="Источник"
                    aria-label={`Источник изображения ${index + 1}`}
                    className="w-full rounded-sm border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-500"
                  />

                  <p className={cn("text-[11px]", tooSmall ? "text-amber-700" : "text-neutral-400")}>
                    {item.width > 0 && item.height > 0
                      ? `${item.width}×${item.height}`
                      : "размер неизвестен"}
                    {tooSmall
                      ? ` — меньше ${DZEN_MIN_WIDTH}×${DZEN_MIN_HEIGHT}, в RSS не попадёт`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-center gap-1">
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Переместить выше"
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                    >
                      <GripVertical className="size-3.5 rotate-90" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label="Переместить ниже"
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                    >
                      <GripVertical className="size-3.5 -rotate-90" aria-hidden />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={`Убрать изображение ${index + 1}`}
                    className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-neutral-400">
        Порядок влияет на RSS-ленту: первое изображение становится превью на
        карточке в Дзене.
      </p>

      {/*
        A dialog rather than an inline note, because the drop that triggers it
        happens over a page the editor is still scrolling past, and a message at
        the bottom of the gallery would be missed entirely. role="alertdialog" with
        a label gives a screen reader the same interruption a sighted reader gets.
      */}
      {videoWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="video-drop-title"
            className="w-full max-w-md rounded-md border border-neutral-300 bg-white p-4 shadow-lg"
          >
            <h3
              id="video-drop-title"
              className="flex items-center gap-2 text-sm font-semibold text-neutral-900"
            >
              <VideoOff className="size-4 text-amber-600" aria-hidden />
              Видеофайл не загружен
            </h3>

            <p className="mt-2 text-sm text-neutral-700">{VIDEO_DROP_WARNING}</p>

            {videoWarning.length > 0 ? (
              <p className="mt-2 font-mono text-xs break-words text-neutral-500">
                {videoWarning.slice(0, 4).join(", ")}
                {videoWarning.length > 4 ? ` и ещё ${videoWarning.length - 4}` : ""}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                // Autofocus so Escape and Enter both dismiss without a click.
                autoFocus
                onClick={() => setVideoWarning(null)}
                className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}