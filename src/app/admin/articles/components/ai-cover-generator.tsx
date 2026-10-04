"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import {
  AiCoverPanel,
  type AiCoverMode,
  type AiCoverResult,
} from "@/app/admin/articles/components/ai-cover-panel";

type AiCoverGeneratorProps = {
  /** Headline and body, so "по тексту статьи" works from this tab alone. */
  title: string;
  lead: string;
  content: string;
  /**
   * Called with the stored URL. The parent decides whether to adopt it: the
   * preview is shown first so a generation can be discarded without touching the
   * article.
   */
  onGenerated: (url: string, prompt: string) => void;
};

/**
 * "Сгенерировать ИИ-обложку" — collapsed button that opens the generator panel.
 *
 * Deliberately two-step, generate then adopt. The image lands on the server as
 * soon as it exists, so writing straight into `coverImage` would leave an editor
 * who dislikes the result with a cover they cannot undo: "Отменить" reverts to
 * the last saved state, not to the two minutes before the click.
 *
 * `auto` sends the story to DeepSeek, which writes the English prompt; `custom`
 * skips that call and uses the editor's own words. Either way the newsroom's
 * style brief is appended server-side.
 */
export function AiCoverGenerator({
  title,
  lead,
  content,
  onGenerated,
}: AiCoverGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AiCoverMode>("auto");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiCoverResult>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/generate-cover", {
        method: "POST",
        // Required, not decorative: the endpoint rejects anything else, which is
        // what stops a cross-origin form from spending the account's credit.
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, prompt: hint, title, lead, content }),
      });
      const payload = (await response.json()) as {
        url?: string;
        prompt?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Не удалось сгенерировать обложку.");
      }

      setResult({ url: payload.url, prompt: payload.prompt ?? "" });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сгенерировать обложку.",
      );
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  /** Adopts the picture and closes. The file itself stays on disk either way. */
  function apply() {
    if (!result) return;
    onGenerated(result.url, result.prompt);
    setResult(null);
    setOpen(false);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
      >
        <Sparkles className="size-4" aria-hidden />
        Сгенерировать ИИ-обложку
      </button>
    );
  }

  return (
    <AiCoverPanel
      mode={mode}
      hint={hint}
      busy={busy}
      error={error}
      result={result}
      onModeChange={(next) => {
        setMode(next);
        setError(null);
      }}
      onHintChange={(next) => {
        setHint(next);
        setError(null);
      }}
      onGenerate={generate}
      onApply={apply}
      onDiscard={() => setResult(null)}
      onClose={() => {
        setOpen(false);
        setError(null);
        setResult(null);
      }}
    />
  );
}