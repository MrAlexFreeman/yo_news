"use client";

import { AlertCircle, CheckCircle2, Loader2, Video } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

type VkVideoDropProps = {
  /**
   * Called with the public VK address. The parent owns `videoUrl`, so a failed or
   * discarded upload cannot leave the field pointing at a video that never landed.
   */
  onUploaded: (url: string) => void;
};

/** What VK's own limits and a sensible newsroom upload converge on. */
const MAX_BYTES = 500 * 1024 * 1024;

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv"];

function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension));
}

/**
 * Drop zone that uploads a video to VK Video and hands back the public link.
 *
 * Progress comes from XMLHttpRequest rather than fetch: `fetch` still has no
 * portable upload-progress event, and the alternative — an indeterminate spinner
 * through a multi-hundred-megabyte upload — leaves the editor unable to tell a
 * slow transfer from a hung one.
 */
export function VkVideoDrop({ onUploaded }: VkVideoDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 0–100, or null while the request is still being prepared. */
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setDone(null);

    if (!looksLikeVideo(file)) {
      setError("Ожидается видеофайл: .mp4, .mov, .webm или .mkv.");
      return;
    }
    if (file.size === 0) {
      setError("Файл пустой.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `Файл больше 500 МБ (${Math.round(file.size / 1024 / 1024)} МБ) — сожмите его или разбейте на части.`,
      );
      return;
    }

    setBusy(true);
    setPercent(0);

    const body = new FormData();
    body.append("file", file);

    try {
      // XHR rather than fetch: upload progress is the reason for this component.
      const result = await new Promise<{ ok: boolean; message: string; url?: string }>(
        (resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/admin/upload-video-vk");
          // The endpoint reads the body as a stream; without this the browser
          // refuses to send the request at all.
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setPercent(Math.round((event.loaded / event.total) * 100));
            }
          };

          xhr.onload = () => {
            let payload: {
              success?: boolean;
              videoUrl?: string;
              error?: string;
            } = {};
            try {
              payload = JSON.parse(xhr.responseText);
            } catch {
              // A non-JSON body here is an nginx or proxy error page.
            }

            resolve({
              ok: xhr.status === 200 && Boolean(payload.success) && Boolean(payload.videoUrl),
              message: payload.error ?? `Сервер ответил ${xhr.status}.`,
              url: payload.videoUrl,
            });
          };

          xhr.onerror = () =>
            resolve({ ok: false, message: "Сеть недоступна или загрузка прервана." });
          xhr.onabort = () => resolve({ ok: false, message: "Загрузка отменена." });
          // A hung connection must not leave the editor on a permanent spinner.
          xhr.timeout = 30 * 60 * 1000;
          xhr.ontimeout = () =>
            resolve({ ok: false, message: "Превышено время ожидания." });

          xhr.send(body);
        },
      );

      if (!result.ok || !result.url) {
        setError(result.message);
        setPercent(null);
        return;
      }

      setDone(result.url);
      onUploaded(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Загрузка не удалась.");
      setPercent(null);
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors",
          busy ? "cursor-wait border-neutral-300 bg-neutral-100" : "cursor-pointer",
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so re-picking the same file fires change again.
            event.target.value = "";
            if (file) void upload(file);
          }}
        />

        {busy ? (
          <>
            <Loader2 className="mx-auto size-5 animate-spin text-blue-700" aria-hidden />
            <p className="mt-2 text-sm text-neutral-700">
              Загружаем в VK Видео…{" "}
              {percent !== null ? <span className="font-mono">{percent}%</span> : null}
            </p>
            <div
              role="progressbar"
              aria-valuenow={percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Загрузка видео в ВК"
              className="mx-auto mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-neutral-200"
            >
              {/* Width transitions so the bar moves smoothly between progress
                  events rather than jumping. */}
              <div
                className="h-full rounded-full bg-blue-600 transition-[width] duration-200"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <Video className="mx-auto size-5 text-neutral-400" aria-hidden />
            <p className="mt-2 text-sm text-neutral-700">
              Перетащите видеофайл сюда для автозагрузки в VK Видео
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              или{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-blue-700 underline hover:text-blue-900"
              >
                выберите файл
              </button>{" "}
              — до 500 МБ. Ролик получит имя материала при публикации.
            </p>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {done ? (
        <p role="status" className="flex items-start gap-1.5 break-all text-xs text-green-700">
          <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
          Загружено: {done}
        </p>
      ) : null}
    </div>
  );
}