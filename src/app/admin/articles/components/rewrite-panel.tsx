"use client";

import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * «Рерайт через DeepSeek» and the picture that follows it.
 *
 * Two buttons, and the second only appears once the first has produced something.
 * That order is the point: the cover generator writes its prompt from the headline,
 * the lead and the body, so a cover made before the rewrite would illustrate the wire's
 * headline rather than the one being published.
 *
 * `content` is deliberately *not* taken from the form state. The rewrite fills the
 * editor, and the editor's state is a render behind at the moment this component is
 * asked for a cover — passing the freshly returned text is what makes one click produce
 * a picture of the article that now exists.
 */

type RewritePanelProps = {
  /** Sent to the rewrite endpoint; empty for a blank article. */
  feedId: string;
  currentTitle: string;
  currentContent: string;
  onRewritten: (result: { title: string; lead: string; contentHtml: string }) => void;
  /** Called with the generated cover URL, once the editor asks for one. */
  onCover: (url: string) => void;
};

type Status = { ok: boolean; text: string } | null;

export function RewritePanel({
  feedId,
  currentTitle,
  currentContent,
  onRewritten,
  onCover,
}: RewritePanelProps) {
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [coverStatus, setCoverStatus] = useState<Status>(null);
  /** The text the rewrite produced, for the cover button. */
  const [draft, setDraft] = useState<{ title: string; lead: string; contentHtml: string } | null>(
    null,
  );

  const hasSource = feedId !== "" || currentTitle.trim() !== "" || currentContent.trim() !== "";

  async function rewrite() {
    setBusy(true);
    setStatus(null);
    setCoverStatus(null);

    try {
      const response = await fetch("/api/admin/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedId,
          // Only sent when there is no wire item: with one, the server uses the stored
          // source rather than whatever is in the form.
          title: feedId ? "" : currentTitle,
          content: feedId ? "" : currentContent,
        }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        title?: string;
        lead?: string;
        contentHtml?: string;
        error?: string;
      };

      if (!response.ok || !result.ok || !result.title || !result.contentHtml) {
        setStatus({ ok: false, text: result.error ?? "Рерайт не удался." });
        return;
      }

      const next = {
        title: result.title,
        lead: result.lead ?? "",
        contentHtml: result.contentHtml,
      };

      setDraft(next);
      onRewritten(next);
      setStatus({ ok: true, text: "Готово: заголовок и текст переписаны." });
    } catch (error) {
      setStatus({
        ok: false,
        text: error instanceof Error ? error.message : "Не удалось выполнить рерайт.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function makeCover() {
    if (!draft) return;
    setCoverBusy(true);
    setCoverStatus(null);

    try {
      const response = await fetch("/api/admin/generate-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          lead: draft.lead,
          content: draft.contentHtml,
        }),
      });

      const result = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !result.url) {
        setCoverStatus({ ok: false, text: result.error ?? "Обложка не получилась." });
        return;
      }

      setCoverStatus({ ok: true, text: "Обложка готова и подставлена в материал." });
      onCover(result.url);
    } catch (error) {
      setCoverStatus({
        ok: false,
        text: error instanceof Error ? error.message : "Не удалось сделать обложку.",
      });
    } finally {
      setCoverBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void rewrite()}
          disabled={busy || !hasSource}
          title={
            hasSource
              ? undefined
              : "Нечего переписывать: откройте инфоповод или напишите текст"
          }
          className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Wand2 className="size-4" aria-hidden />
          )}
          {busy ? "Переписываем…" : "Рерайт через DeepSeek"}
        </button>

        {draft ? (
          <button
            type="button"
            onClick={() => void makeCover()}
            disabled={coverBusy}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            {coverBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {coverBusy ? "Рисуем…" : "Сделать обложку"}
          </button>
        ) : null}
      </div>

      <p className="text-xs text-neutral-400">
        Переписывает источник в заголовок, лид и 3–5 абзацев, сохраняя факты, имена и
        цифры. Результат подставляется в поля ниже — их можно править как обычно.
      </p>

      {status ? (
        <p
          role="status"
          className={cn("text-xs", status.ok ? "text-green-700" : "text-red-600")}
        >
          {status.text}
        </p>
      ) : null}

      {coverStatus ? (
        <p
          role="status"
          className={cn("text-xs", coverStatus.ok ? "text-green-700" : "text-red-600")}
        >
          {coverStatus.text}
        </p>
      ) : null}
    </section>
  );
}
