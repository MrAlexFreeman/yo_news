"use client";

import { GripVertical, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import type { MediaItem } from "@/lib/article-media";
import { DZEN_MIN_HEIGHT, DZEN_MIN_WIDTH, MAX_MEDIA_ITEMS } from "@/lib/article-media";
import { cn } from "@/lib/utils";

type MediaEditorProps = {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
};

/** Same ceiling the upload endpoint enforces, per file. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/gif";

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
    const queue = [...files].filter((file) => !items.some((i) => i.url === file.name));
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
        const dimensions = await readDimensions(file);

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
    </div>
  );
}

/**
 * Reads a file's pixel size in the browser.
 *
 * createImageBitmap is the cheap path and works for the formats the endpoint
 * accepts; the Image() fallback covers Safari's older behaviour. Both are
 * decode-only, so a large photo costs a few milliseconds and nothing is uploaded.
 */
function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return createImageBitmap(file)
    .then((bitmap) => {
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    })
    .catch(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          const url = URL.createObjectURL(file);
          const probe = new window.Image();
          probe.onload = () => {
            resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
            URL.revokeObjectURL(url);
          };
          probe.onerror = () => {
            resolve({ width: 0, height: 0 });
            URL.revokeObjectURL(url);
          };
          probe.src = url;
        }),
    );
}