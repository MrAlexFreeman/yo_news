"use client";

import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";

import { AI_HINT_LIMIT } from "@/lib/cover-prompt";
import { cn } from "@/lib/utils";

export type AiCoverMode = "auto" | "custom";

export type AiCoverResult = { url: string; prompt: string } | null;

type AiCoverPanelProps = {
  mode: AiCoverMode;
  hint: string;
  busy: boolean;
  error: string | null;
  result: AiCoverResult;
  onModeChange: (mode: AiCoverMode) => void;
  onHintChange: (hint: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

/**
 * The open state of the AI cover generator.
 *
 * Presentational on purpose: `AiCoverGenerator` owns the state and this renders
 * it. Splitting them is what lets the test suite reach the busy, error and
 * result states, which are the ones that matter — none of them is reachable by
 * mounting the shell and taking a snapshot.
 */
export function AiCoverPanel({
  mode,
  hint,
  busy,
  error,
  result,
  onModeChange,
  onHintChange,
  onGenerate,
  onApply,
  onDiscard,
  onClose,
}: AiCoverPanelProps) {
  const custom = mode === "custom";

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

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-neutral-600">Источник подсказки</legend>
        {(
          [
            { value: "auto" as const, label: "По тексту статьи" },
            { value: "custom" as const, label: "По своей подсказке" },
          ]
        ).map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-sm text-neutral-700"
          >
            <input
              type="radio"
              name="aiCoverMode"
              value={option.value}
              checked={mode === option.value}
              // Disabled while generating so the two modes cannot be swapped
              // mid-flight and leave the panel describing a different image.
              disabled={busy}
              onChange={() => onModeChange(option.value)}
              className="size-4 accent-neutral-700"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="aiCoverHint" className="text-xs font-medium text-neutral-600">
          Подсказка на русском
        </label>
        <textarea
          id="aiCoverHint"
          value={hint}
          // Disabled rather than hidden in auto mode: the editor can see what the
          // option is and what they would be overriding, instead of the field
          // appearing from nowhere when they switch.
          disabled={!custom || busy}
          rows={2}
          maxLength={AI_HINT_LIMIT}
          onChange={(event) => onHintChange(event.target.value)}
          placeholder="Например: ночная улица Екатеринбурга после сильного ливня, фонари отражаются в асфальте"
          className={cn(
            "w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
            "placeholder:text-neutral-400 focus:ring-2",
            custom
              ? "border-neutral-300 bg-white text-neutral-800 focus:border-neutral-500 focus:ring-neutral-200"
              : "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400",
          )}
        />
        <p className="text-xs text-neutral-400">
          {custom
            ? `${hint.length} из ${AI_HINT_LIMIT}. Стиль добавляется автоматически.`
            : "Описание новости составит DeepSeek. Подсказка не используется."}
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
        {busy ? "Генерируем…" : "Сгенерировать"}
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