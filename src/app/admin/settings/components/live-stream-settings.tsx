"use client";

import { Check, Loader2, Radio } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The «Прямой эфир» badge controls.
 *
 * A third block on the settings page, separate from the API-key form and from the messenger
 * block, because none of those loops fits: this one has no secret to mask, one boolean, and
 * two plain text fields — one of which becomes an `href` in the masthead of every page.
 *
 * Nothing here is masked and everything is echoed back after a save, which is what the
 * messenger block already does for destinations. The reason is the same: an editor who cannot
 * see the stored URL cannot tell a wrong one from a missing one.
 */
export type LiveStreamState = {
  enabled: boolean;
  url: string;
  title: string;
  /** Resolved from the stored values on the server: null when there is no safe link. */
  href?: string | null;
  /** What the header will actually print. */
  label?: string;
};

export function LiveStreamSettings({ initial }: { initial: LiveStreamState }) {
  const [state, setState] = useState<LiveStreamState>(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [url, setUrl] = useState(initial.url);
  const [title, setTitle] = useState(initial.title);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty =
    enabled !== state.enabled || url.trim() !== state.url || title.trim() !== state.title;

  /*
    Every field is always sent, unlike the API-key form.

    The key form omits untouched fields so an empty input cannot clear a stored secret. Here
    there is nothing to protect that way, and omitting would be actively wrong for the
    checkbox: a boolean that is not sent is not turned off, so unchecking the toggle and
    pressing Save would report success and leave the badge in the masthead.
  */
  const payload = useCallback(
    () => ({
      liveStreamEnabled: String(enabled),
      liveStreamUrl: url.trim(),
      liveStreamTitle: title.trim(),
    }),
    [enabled, url, title],
  );

  async function save() {
    setSaving(true);
    setFormError(null);
    setErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/live-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        liveStream?: LiveStreamState;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error ?? "Не удалось сохранить настройки эфира.");
        return;
      }

      /*
        Adopt what the server re-read rather than what was typed. Only the server knows
        whether the stored URL survived validation — a value the field accepts can still be
        refused server-side — and the badge's rendered label is resolved there too.
      */
      if (result.liveStream) {
        const next = result.liveStream;
        setState(next);
        setEnabled(next.enabled);
        setUrl(next.url);
        setTitle(next.title);
      }

      setSaved(
        enabled
          ? "Эфир включён — значок появился в шапке."
          : "Эфир выключен — значок убран из шапки.",
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось сохранить настройки эфира.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 border border-neutral-300 bg-white p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
          <Radio className="size-4" aria-hidden />
          Прямой эфир
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Значок «Прямой эфир» в шапке — в мачте и в компактной панели при прокрутке.
        </p>
      </div>

      <label
        htmlFor="liveStreamEnabled"
        className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900"
      >
        <input
          id="liveStreamEnabled"
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700"
        />
        Показывать значок «Прямой эфир» в шапке
      </label>

      <div className="space-y-1.5">
        <label htmlFor="liveStreamUrl" className="text-sm font-medium text-neutral-700">
          Ссылка на эфир
        </label>
        <input
          id="liveStreamUrl"
          type="text"
          value={url}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/embed/… или /live"
          aria-invalid={Boolean(errors.liveStreamUrl)}
          aria-describedby={errors.liveStreamUrl ? "liveStreamUrlError" : undefined}
          className={cn(
            "w-full rounded-md border px-3 py-2 font-mono text-sm outline-none",
            "placeholder:text-neutral-400 focus:ring-2",
            errors.liveStreamUrl
              ? "border-red-400 bg-red-50 focus:ring-red-200"
              : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
          )}
        />
        {errors.liveStreamUrl ? (
          <p id="liveStreamUrlError" role="alert" className="text-xs text-red-600">
            {errors.liveStreamUrl}
          </p>
        ) : null}
        <p className="text-xs text-neutral-500">
          Путь внутри сайта (например <span className="font-mono">/live</span>) либо
          внешний адрес <span className="font-mono">https://…</span>. Внешний адрес
          откроется в новой вкладке. Пусто — значок останется, но без ссылки.
        </p>
        {state.url && state.href === null ? (
          <p className="text-xs text-amber-700">
            Сейчас сохранено: <span className="font-mono">{state.url}</span> — это значение
            не используется как ссылка, потому что оно не является безопасным адресом.
          </p>
        ) : state.url ? (
          <p className="text-xs text-neutral-500">
            Сейчас сохранено: <span className="font-mono">{state.url}</span>
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="liveStreamTitle" className="text-sm font-medium text-neutral-700">
          Подпись
        </label>
        <input
          id="liveStreamTitle"
          type="text"
          value={title}
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Прямой эфир"
          aria-invalid={Boolean(errors.liveStreamTitle)}
          aria-describedby={errors.liveStreamTitle ? "liveStreamTitleError" : undefined}
          className={cn(
            "w-full rounded-md border px-3 py-2 text-sm outline-none",
            "placeholder:text-neutral-400 focus:ring-2",
            errors.liveStreamTitle
              ? "border-red-400 bg-red-50 focus:ring-red-200"
              : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
          )}
        />
        {errors.liveStreamTitle ? (
          <p id="liveStreamTitleError" role="alert" className="text-xs text-red-600">
            {errors.liveStreamTitle}
          </p>
        ) : null}
        <p className="text-xs text-neutral-500">
          Что напечатает значок. Пусто — «Прямой эфир». Сейчас:{" "}
          <span className="font-medium text-neutral-700">{state.label ?? "Прямой эфир"}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          Сохранить
        </button>

        {dirty && !saving ? (
          <span className="text-xs text-neutral-500">Есть несохранённые изменения.</span>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-green-700">
          <Check className="size-4" aria-hidden />
          {saved}
        </p>
      ) : null}

      <details className="rounded-sm border border-neutral-200 bg-neutral-50">
        <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900">
          Что увидит читатель
        </summary>
        <div className="border-t border-neutral-200 px-2 py-2 text-xs text-neutral-600">
          {enabled ? (
            state.href ? (
              <p>
                В шапке будет ссылка «{state.label}» на{" "}
                <span className="font-mono">{state.href}</span>
                {/^https:\/\//i.test(state.href)
                  ? ", она откроется в новой вкладке."
                  : "."}
              </p>
            ) : (
              <p>
                В шапке будет надпись «{state.label}» без ссылки — адрес не задан или не
                является безопасным.
              </p>
            )
          ) : (
            <p>Значок не выводится. Поиск остаётся прижатым к правому краю.</p>
          )}
        </div>
      </details>
    </section>
  );
}