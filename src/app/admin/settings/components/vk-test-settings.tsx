"use client";

import { Check, Loader2, Send, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * «Тест отправки в ВК с фото».
 *
 * The cover has been failing silently in production, and it failed in a way this project's
 * checks could not see: the suite stubbed VK's upload endpoint, the stub encoded the same
 * wrong belief the module held, and both agreed that a cover was attached while the wall got
 * bare text. What no stub can do is ask VK what is actually on the post — so the test does
 * exactly that, against the live API, and reports what came back.
 *
 * The button publishes a real post built from the latest published story's cover, reads the
 * post back, and then removes it. The «оставить на стене» checkbox skips the removal, for an
 * editor who wants to look at the result with their own eyes.
 */
export function VkTestSettings() {
  const [running, setRunning] = useState(false);
  const [keep, setKeep] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/vk/test-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep }),
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };

      setResult({
        ok: payload.ok === true,
        message:
          payload.message ??
          `Сервер ответил ${response.status}, но без объяснения. Смотрите логи.`,
      });
    } catch (error) {
      setResult({
        ok: false,
        message: `Не удалось обратиться к серверу: ${
          error instanceof Error ? error.message : "сетевая ошибка"
        }`,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-4 border border-neutral-300 bg-white p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
          <Send className="size-4" aria-hidden />
          Репост в ВК
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Проверка прикрепления обложки к посту на стене сообщества. Берётся обложка последнего
          опубликованного материала, пост отправляется по-настоящему, и сразу видно, прикрепилось
          ли фото.
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900">
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
          className="size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700"
        />
        Оставить тестовый пост на стене
      </label>

      <p className="text-xs text-neutral-500">
        Без этой галочки тестовый пост удаляется сразу после проверки, чтобы не засорять стену.
        Обложка при этом остаётся в фотоальбоме сообщества.
      </p>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {running ? "Отправляем…" : "Тест отправки в ВК с фото"}
        </button>

        <span className="text-xs text-neutral-500">
          Подробности каждого шага пишутся в лог: <span className="font-mono">pm2 logs uartnews | grep vk</span>
        </span>
      </div>

      {result ? (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 rounded-sm border px-3 py-2 text-sm",
            result.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {result.ok ? (
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
