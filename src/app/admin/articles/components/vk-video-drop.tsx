"use client";

import { AlertCircle, CheckCircle2, Loader2, Smartphone, Video } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** What a successful upload gives the form: the address and the VK attachment id. */
export type UploadedVideo = {
  /** Public page, stored in `Article.videoUrl`. */
  url: string;
  /** `video{owner}_{id}`, stored in `Article.vkVideoId` for the wall post. */
  vkVideoId: string;
};

type VkVideoDropProps = {
  /**
   * Called with the public VK address and the attachment id. The parent owns both fields,
   * so a failed or discarded upload cannot leave the form pointing at a video that never
   * landed.
   */
  onUploaded: (video: UploadedVideo) => void;
  /**
   * Готовый заголовок материала — он же имя ролика на ВК. Пусто у нового материала:
   * сервер тогда поставит имя по дате, а публикация всё равно переименует ролик.
   */
  title?: string;
  /** Лид материала — описание ролика. Необязательно. */
  description?: string;
  /**
   * Вставить плеер в текст статьи. Возвращает место вставки, чтобы зона сказала, куда он
   * попал, или null, если редактор ещё не готов. Без этого пропа кнопки вставки нет.
   */
  onInsertPlayer?: (url: string) => "caret" | "end" | null;
};

/** What VK's own limits and a sensible newsroom upload converge on. */
const MAX_BYTES = 500 * 1024 * 1024;

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv"];

function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension));
}

type UploadAnswer = {
  ok?: boolean;
  vkVideoId?: string;
  playerUrl?: string;
  error?: string;
};

/**
 * Drop zone that uploads a video to VK Video and hands back the public link and attachment id.
 *
 * Progress comes from XMLHttpRequest rather than fetch: `fetch` still has no
 * portable upload-progress event, and the alternative — an indeterminate spinner
 * through a multi-hundred-megabyte upload — leaves the editor unable to tell a
 * slow transfer from a hung one.
 *
 * `title` and `description` go into the body **before** the file. The server streams the
 * body instead of parsing it into memory, and that parser returns as soon as the file is on
 * disk; fields behind the file would never be read. Losing them is not fatal — VK then keeps
 * a timestamped name — which is why this ordering is a note and not a comment shouting.
 */
export function VkVideoDrop({
  onUploaded,
  title = "",
  description = "",
  onInsertPlayer,
}: VkVideoDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 0–100, or null while the request is still being prepared. */
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadedVideo | null>(null);
  /** Where the player went, after the editor pressed the insert button. */
  const [inserted, setInserted] = useState<"caret" | "end" | null>(null);

  async function upload(file: File) {
    setError(null);
    setDone(null);
    setInserted(null);

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
    if (title.trim()) body.append("title", title.trim());
    if (description.trim()) body.append("description", description.trim());
    // The file is appended last on purpose — see the note above the component.
    body.append("file", file);

    try {
      // XHR rather than fetch: upload progress is the reason for this component.
      const result = await new Promise<{
        ok: boolean;
        message: string;
        video?: UploadedVideo;
      }>((resolve) => {
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
          let payload: UploadAnswer = {};
          try {
            payload = JSON.parse(xhr.responseText) as UploadAnswer;
          } catch {
            // A non-JSON body here is an nginx or proxy error page.
          }

          const video =
            payload.ok && payload.playerUrl && payload.vkVideoId
              ? { url: payload.playerUrl, vkVideoId: payload.vkVideoId }
              : undefined;

          resolve({
            ok: xhr.status === 200 && Boolean(video),
            message: payload.error ?? `Сервер ответил ${xhr.status}.`,
            video,
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
      });

      if (!result.ok || !result.video) {
        setError(result.message);
        setPercent(null);
        return;
      }

      setDone(result.video);
      onUploaded(result.video);
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
          busy ? "cursor-wait border-neutral-300 bg-neutral-100" : "border-neutral-300",
          dragging ? "border-blue-500 bg-blue-50" : "bg-neutral-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
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
            {/*
              The button is the phone path: a newsroom films on a phone, and a tap on a
              44-pixel target is the difference between uploading from the field and waiting
              to get back to a laptop. Drag-and-drop stays for the desktop.
            */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 active:bg-neutral-800"
            >
              <Smartphone className="size-4" aria-hidden />
              Выбрать видео с телефона
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              или перетащите файл сюда — до 500 МБ
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
        <div className="space-y-1 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <p className="flex items-start gap-1.5 break-all text-xs text-green-800">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Загружено: {done.url}
              <span className="mt-0.5 block font-mono text-[11px] text-green-700">
                {done.vkVideoId}
              </span>
            </span>
          </p>

          {onInsertPlayer ? (
            <button
              type="button"
              onClick={() => {
                const placement = onInsertPlayer(done.url);
                setInserted(placement);
              }}
              className="text-xs font-medium text-green-900 underline hover:text-green-700"
            >
              Вставить плеер в текст
            </button>
          ) : null}

          {inserted === "caret" ? (
            <p role="status" className="text-xs text-green-700">
              Плеер вставлен по курсору.
            </p>
          ) : null}
          {inserted === "end" ? (
            <p role="status" className="text-xs text-green-700">
              Плеер добавлен в конец текста: курсор не стоял в статье.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
