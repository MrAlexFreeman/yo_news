"use client";

import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";

import { AI_HINT_LIMIT } from "@/lib/cover-prompt";
import { cn } from "@/lib/utils";

export type AiCoverResult = { url: string; prompt: string } | null;

type AiCoverPanelProps = {
  hint: string;
  busy: boolean;
  error: string | null;
  result: AiCoverResult;
  onHintChange: (hint: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

/** The field's example hint, shown as placeholder text. */
export const AI_HINT_PLACEHOLDER =
  "Например: крупный план светофора, снег, сумерки (необязательно, уточняет контекст новости)";

/**
 * The open state of the AI cover generator.
 *
 * Presentational on purpose: `AiCoverGenerator` owns the state and this renders
 * it. Splitting them is what lets the test suite reach the busy, error and
 * result states, which are the ones that matter — none of them is reachable by
 * mounting the shell and taking a snapshot.
 *
 * One input, not two modes. The panel used to offer "по тексту статьи" against
 * "по своей подсказке", and picking the second sent only the hint, so the story
 * the editor was looking at stopped mattering. The hint now refines whatever the
 * story already says, which is also why it is optional and always enabled.
 */
export function AiCoverPanel({
  hint,
  busy,
  error,
  result,
  onHintChange,
  onGenerate,
  onApply,
  onDiscard,
  onClose,
}: AiCoverPanelProps) {
  return (
    <div className="space-y-3 rounded-md border border-neutral-300 bg-neutral-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Sparkles className="size-4" aria-hidden />
          Генерация обложки
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть генератор"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="aiCoverHint" className="text-xs font-medium text-neutral-600">
          Подсказка для обложки
        </label>
        <textarea
          id="aiCoverHint"
          value={hint}
          // Only ever disabled while a request is in flight: editing the hint
          // mid-generation would leave the panel describing an image that was made
          // from something else.
          disabled={busy}
          rows={2}
          maxLength={AI_HINT_LIMIT}
          onChange={(event) => onHintChange(event.target.value)}
          placeholder={AI_HINT_PLACEHOLDER}
          className={cn(
            "w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
            "placeholder:text-neutral-400 focus:ring-2",
            busy
              ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
              : "border-neutral-300 bg-white text-neutral-800 focus:border-neutral-500 focus:ring-neutral-200",
          )}
        />
        <p className="text-xs text-neutral-400">
          {hint.length} из {AI_HINT_LIMIT}. Заголовок и лид новости учитываются всегда,
          подсказка уточняет кадр. Стиль добавляется автоматически.
        </p>
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-4" aria-hidden />
        )}
        {busy ? "Генерируем…" : "Сгенерировать обложку"}
      </button>

      {busy ? (
        <p role="status" className="text-xs text-neutral-400">
          Два запроса: текстовая модель пишет промпт, затем рисуется картинка.
          Обычно это 10–30 секунд.
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-md border border-neutral-300 bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.url}
            alt="Сгенерированная обложка"
            className="max-h-64 w-full rounded border border-neutral-200 object-contain"
          />
          {result.prompt ? (
            <p className="text-[11px] text-neutral-400">Промпт: {result.prompt}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onApply}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-900"
            >
              Использовать как обложку
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
            >
              Отменить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}