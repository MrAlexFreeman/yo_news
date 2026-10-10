"use client";

import { Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * «Улучшить качество» — upscale and de-noise the cover that is already set.
 *
 * **Adopt-then-revert, not replace-then-hope.** The result is a new file, so the original is
 * still on the server and still in the field's history; «Вернуть оригинал» puts it back. The
 * alternative — upscaling straight into `coverImage` — leaves an editor who dislikes the
 * result with no way back, because "Отменить" in this form reverts to the last *saved* state
 * and the original was saved minutes ago.
 *
 * The button is rendered only when there is a cover to improve, and the request is refused
 * server-side unless that cover is a stored upload, so there is no state here where a click
 * can cost money and produce nothing.
 */

type UpscaleResult = {
  url: string;
  width: number;
  height: number;
  scale: number;
  face: boolean;
  provider?: string;
  providerLabel?: string;
};

type UpscaleCoverButtonProps = {
  /** The stored cover, or "" when none is set — the button is hidden in that case. */
  coverImage: string;
  /** Called with the improved URL. The parent decides what else changes with it. */
  onUpscaled: (url: string) => void;
};

export function UpscaleCoverButton({
  coverImage,
  onUpscaled,
}: UpscaleCoverButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UpscaleResult | null>(null);
  /**
   * Which file replaced which, kept as a pair rather than as a bare "original".
   *
   * The pair is what makes the revert button honest. With only the original stored, an editor
   * who upgrades a cover, uploads a different photo, and upgrades that one would still be
   * offered «Вернуть оригинал» — and it would silently restore the *first* photo, a cover
   * that has not been on screen for a minute. Comparing the stored destination against the
   * current `coverImage` is what closes that, without an effect watching the prop.
   */
  const [upgrade, setUpgrade] = useState<{ from: string; to: string } | null>(null);

  const canRevert = upgrade !== null && upgrade.to === coverImage;

  if (!coverImage) return null;

  async function upscale() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/articles/upscale-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverImage,
          // Two, not four: four quadruples the pixel count and the result can exceed the
          // upload cap the cover itself is bound by. The editor can ask for four later.
          scale: 2,
          // GFPGAN pass, so the faces in a reportorial photo are not the first thing to
          // smear. This is exactly what the field is for.
          face: true,
        }),
      });

      const payload = (await response.json()) as UpscaleResult & {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Не удалось улучшить фото, попробуйте позже.");
      }

      // Remembered once. On a second click the pair is already set, and overwriting it would
      // make the revert point at the already-improved file instead of the photograph.
      setUpgrade((current) => current ?? { from: coverImage, to: payload.url! });
      onUpscaled(payload.url);
      setDone({
        url: payload.url,
        width: payload.width,
        height: payload.height,
        scale: payload.scale,
        face: payload.face,
        providerLabel: payload.providerLabel,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось улучшить фото, попробуйте позже.",
      );
      setDone(null);
    } finally {
      setBusy(false);
    }
  }

  function revert() {
    if (!upgrade) return;
    onUpscaled(upgrade.from);
    setUpgrade(null);
    setDone(null);
    setError(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void upscale()}
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          {busy ? "Улучшаем…" : "Улучшить качество"}
        </button>

        {/*
          Reverting is offered only while an improved file is in place. Before the first
          upgrade there is nothing to go back to, and a button that does nothing is worse
          than no button.
        */}
        {canRevert ? (
          <button
            type="button"
            onClick={revert}
            disabled={busy}
            className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            <RotateCcw className="size-4" aria-hidden />
            Вернуть оригинал
          </button>
        ) : null}
      </div>

      {/*
        The loader text is not a spinner alone. An upscale submits to a GPU queue and can
        sit there for a while, and a button that simply stops responding is the state an
        editor concludes "the site is broken" and reloads — losing the article they were
        editing. Saying what is happening, and how long it may take, is what keeps them
        waiting instead.
      */}
      {busy ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-neutral-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ИИ убирает артефакты и повышает резкость — обычно это занимает до минуты.
        </p>
      ) : null}

      {done ? (
        <p
          role="status"
          className={cn("flex items-center gap-1.5 text-xs text-green-700")}
        >
          <Check className="size-3.5" aria-hidden />
          Фото успешно улучшено
          {done.width > 0 && done.height > 0
            ? ` — ${done.width}×${done.height}, увеличение в ${done.scale} раза`
            : ""}
          {/*
            Which engine ran. There are now two providers, and an editor who set a second key
            has no other way to learn whether it did anything — a site that silently ignores
            a saved credential is indistinguishable from one that lost it.
          */}
          {done.providerLabel ? `, через ${done.providerLabel}` : ""}
          .
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}