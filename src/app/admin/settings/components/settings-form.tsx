"use client";

import { Check, ChevronRight, ExternalLink, Eye, EyeOff, Loader2, Plug, Save, X } from "lucide-react";
import { useState } from "react";

import { mergeSettings, type SettingView, type SettingsViewState } from "@/lib/settings-keys";
import { cn } from "@/lib/utils";

/** Matches the server-side shape from src/lib/settings.ts. */
type Provider = "deepseek" | "deepinfra" | "vk";

type Field = {
  provider: Provider;
  name: string;
  label: string;
  hint: string;
  /** URL for the "test" note, so an editor knows where the key is going. */
  service: string;
  /** Label of the test button; VK's is a token, not a key. */
  testLabel?: string;
  /** Collapsible "how do I get this" panel. */
  instructions?: { title: string; steps: string[]; linkLabel?: string; link?: string };
};

const FIELDS: Field[] = [
  {
    provider: "deepseek",
    name: "deepseekApiKey",
    label: "Ключ DeepSeek API",
    hint: "Составляет английский промпт для генератора обложки.",
    service: "api.deepseek.com",
    testLabel: "Тест подключения",
  },
  {
    provider: "deepinfra",
    name: "deepinfraApiKey",
    label: "Ключ DeepInfra API",
    hint: "Рисует картинку моделью FLUX-1-schnell.",
    service: "api.deepinfra.com",
    testLabel: "Тест подключения",
  },
  {
    provider: "vk",
    name: "vkAccessToken",
    label: "Пользовательский токен ВКонтакте (VK_ACCESS_TOKEN)",
    hint: "Репост материалов на стену сообщества и автозагрузка видео в VK Видео.",
    service: "api.vk.com",
    testLabel: "Тест токена VK",
    instructions: {
      title: "Как получить токен VK?",
      steps: [
        "Зайдите на dev.vk.com и создайте Standalone-приложение.",
        "Перейдите по ссылке (подставьте ID своего приложения):",
        "Нажмите «Разрешить» и скопируйте access_token из адресной строки (флаг offline делает токен бессрочным).",
      ],
      linkLabel: "Перейти по ссылке",
      link:
        "https://oauth.vk.com/authorize?client_id=ID_ПРИЛОЖЕНИЯ&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=video,wall,offline,groups&response_type=token&v=5.199",
    },
  },
];

type TestState = { ok: boolean; message: string } | null;

type SettingsFormProps = {
  initial: Record<string, SettingView>;
};

/**
 * API keys form.
 *
 * Keys are write-only from the browser's point of view: the server sends a mask
 * and an `isSet` flag, never the value, so the input always starts empty and an
 * empty submission leaves that key alone. Clearing a key is an explicit action —
 * the button next to the field — because an editor who wants to keep a working
 * key must not be able to lose it by pressing Save with an empty box.
 *
 * What the page displays lives in `views` state, seeded from the server-rendered
 * props and then replaced by the state the POST response carries. It used to render
 * from the props alone, which froze the display at its pre-save value: pasting a
 * first key and saving left "Ключ не задан" on screen under a green "сохранено",
 * and an editor reasonably read that as the key being dropped.
 */
export function SettingsForm({ initial }: SettingsFormProps) {
  const [views, setViews] = useState<SettingsViewState>(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  async function save() {
    const payload: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      if (value.trim()) payload[name] = value.trim();
    }

    if (Object.keys(payload).length === 0) {
      setFormError("Заполните хотя бы одно поле или очистите ключ кнопкой рядом с ним.");
      setSaved(null);
      return;
    }

    setSaving(true);
    setFormError(null);
    setErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        settings?: Record<string, SettingView>;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error ?? "Не удалось сохранить настройки.");
        return;
      }

      setSaved(
        "Настройки сохранены. Генератор обложек использует их сразу — перезапуск не нужен.",
      );
      // Adopt the state the server re-read after the write. This is the only place
      // that knows whether a key landed in the database or fell back to `.env`, and
      // without it the page keeps showing the pre-save masks and "не задан".
      setViews((current) => mergeSettings(current, result.settings));
      // Drop the typed values so the inputs go back to showing a mask rather than
      // a live key sitting in the DOM.
      setValues({});
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Не удалось сохранить настройки.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear(name: string) {
    setSaving(true);
    setFormError(null);
    setErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An empty string is the documented way to drop the override; the server
        // then falls back to .env if a key is configured there.
        body: JSON.stringify({ [name]: "" }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        settings?: SettingsViewState;
      };

      if (!response.ok || !result.ok) {
        setFormError(result.error ?? "Не удалось очистить ключ.");
        return;
      }

      setSaved("Ключ удалён из базы. Если он есть в .env, используется он.");
      // Same reason as after a save: the fallback to `.env` is only knowable from
      // the response, so the "Сейчас задан" line and the "Очистить" button have to
      // follow it rather than keep describing the key that was just removed.
      setViews((current) => mergeSettings(current, result.settings));
      setValues((current) => ({ ...current, [name]: "" }));
      setTests((current) => ({ ...current, [name]: null }));
    } finally {
      setSaving(false);
    }
  }

  async function test(field: Field) {
    setTesting((current) => ({ ...current, [field.provider]: true }));
    setTests((current) => ({ ...current, [field.provider]: null }));

    try {
      const typed = values[field.name]?.trim() ?? "";
      const response = await fetch("/api/admin/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The typed key wins over the stored one: that is what an editor is
        // asking to verify.
        body: JSON.stringify({ provider: field.provider, key: typed }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };

      setTests((current) => ({
        ...current,
        [field.provider]:
          result.ok === undefined
            ? { ok: false, message: result.error ?? "Проверка не удалась." }
            : { ok: Boolean(result.ok), message: result.message ?? "" },
      }));
    } catch (error) {
      setTests((current) => ({
        ...current,
        [field.provider]: {
          ok: false,
          message:
            error instanceof Error ? error.message : "Не удалось выполнить проверку.",
        },
      }));
    } finally {
      setTesting((current) => ({ ...current, [field.provider]: false }));
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 border border-neutral-300 bg-white p-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Ключи API</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Ключи хранятся в базе данных и применяются сразу после сохранения.
            Перезапуск приложения не требуется.
          </p>
        </div>

        {FIELDS.map((field) => {
          const current = views[field.name];
          const typed = values[field.name] ?? "";
          const isShown = revealed[field.name] ?? false;
          const testResult = tests[field.provider];

          return (
            <div key={field.name} className="space-y-1.5 border-t border-neutral-200 pt-4">
              <label
                htmlFor={field.name}
                className="text-sm font-medium text-neutral-700"
              >
                {field.label}
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-56 flex-1">
                  <input
                    id={field.name}
                    type={isShown ? "text" : "password"}
                    value={typed}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setValues((all) => ({ ...all, [field.name]: event.target.value }))
                    }
                    placeholder={current?.isSet ? current.masked : "не задан"}
                    aria-invalid={Boolean(errors[field.name])}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 pr-10 font-mono text-sm outline-none",
                      "placeholder:text-neutral-400 focus:ring-2",
                      errors[field.name]
                        ? "border-red-400 bg-red-50 focus:ring-red-200"
                        : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setRevealed((all) => ({ ...all, [field.name]: !isShown }))
                    }
                    aria-label={isShown ? "Скрыть ключ" : "Показать ключ"}
                    aria-pressed={isShown}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
                  >
                    {isShown ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void test(field)}
                  disabled={testing[field.provider] || saving}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                >
                  {testing[field.provider] ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Plug className="size-4" aria-hidden />
                  )}
                  {field.testLabel ?? "Тест подключения"}
                </button>

                {current?.isSet ? (
                  <button
                    type="button"
                    onClick={() => void clear(field.name)}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                  >
                    <X className="size-4" aria-hidden />
                    Очистить
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-neutral-500">
                {field.hint}{" "}
                {current?.isSet ? (
                  <span className="text-neutral-700">
                    Сейчас задан: <span className="font-mono">{current.masked}</span>{" "}
                    {current.source === "database"
                      ? "(в базе данных)."
                      : "(из .env, в базе пусто)."}
                  </span>
                ) : (
                  <span>Ключ не задан — генерация обложек вернёт понятную ошибку.</span>
                )}
              </p>

              {errors[field.name] ? (
                <p role="alert" className="text-xs text-red-600">
                  {errors[field.name]}
                </p>
              ) : null}

              {testResult ? (
                <p
                  role="status"
                  className={cn(
                    "flex items-start gap-1.5 text-xs",
                    testResult.ok ? "text-green-700" : "text-red-600",
                  )}
                >
                  {testResult.ok ? (
                    <Check className="mt-px size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <X className="mt-px size-3.5 shrink-0" aria-hidden />
                  )}
                  {testResult.message}
                </p>
              ) : null}

              <p className="text-[11px] text-neutral-400">
                Ключ отправляется на {field.service}.
              </p>

              {field.instructions ? (
                <details className="rounded-sm border border-neutral-200 bg-white">
                  {/* <details> rather than a button plus state: the panel opens with
                      the keyboard, prints, and needs no ARIA wiring to be usable. */}
                  <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight
                        className="size-3.5 transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                      {field.instructions.title}
                    </span>
                  </summary>
                  <ol className="space-y-1.5 border-t border-neutral-200 px-2 py-2 text-xs text-neutral-600">
                    {field.instructions.steps.map((step, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="font-mono text-neutral-400">{index + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  {field.instructions.link && field.instructions.linkLabel ? (
                    <p className="px-2 pb-2">
                      <a
                        href={field.instructions.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline hover:text-blue-900"
                      >
                        {field.instructions.linkLabel}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </p>
                  ) : null}
                </details>
              ) : null}
            </div>
          );
        })}

        <div className="flex items-center gap-3 border-t border-neutral-200 pt-4">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Сохранить настройки
          </button>
        </div>

        {formError ? (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            {saved}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 border border-neutral-300 bg-white p-5">
        <h2 className="text-base font-semibold text-neutral-900">Как это работает</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600">
          <li>
            Сначала ключ берётся из базы данных. Если там пусто — из{" "}
            <code className="font-mono text-xs">.env</code>. Если пусто везде —
            генерация обложек отвечает понятной ошибкой, обычная загрузка файла
            продолжает работать.
          </li>
          <li>
            Ключ не покидает сервер: в браузер приходит только маска вида{" "}
            <span className="font-mono text-xs">sk-abc…7890</span>.
          </li>
          <li>
            «Тест подключения» обращается к бесплатной проверке — балансу DeepSeek и
            списку моделей DeepInfra. Деньги при этом не списываются.
          </li>
          <li>
            Очистка удаляет ключ из базы. Если он есть в{" "}
            <code className="font-mono text-xs">.env</code>, снова используется он.
          </li>
        </ul>
      </section>
    </div>
  );
}