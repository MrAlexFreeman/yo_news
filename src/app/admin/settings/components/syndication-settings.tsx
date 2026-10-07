"use client";

import { Check, Loader2, Plug, Send, X } from "lucide-react";
import { useCallback, useState } from "react";

import type { SettingView } from "@/lib/settings-keys";
import { cn } from "@/lib/utils";

/**
 * Telegram and MAX auto-posting settings.
 *
 * Separate from the API-key form above rather than folded into it, because these
 * fields are a different shape: a destination that is not a secret, a boolean, and a
 * test button that really does post to a channel. The API-key form's field loop
 * assumes one secret per provider, and bending it to fit would have put a checkbox
 * inside a loop written for text inputs.
 *
 * Tokens behave exactly as they do there — write-only from the browser, masked on the
 * way back, empty submission leaves the stored value alone — because the server
 * returns a mask and an `isSet` flag rather than the value, and this component never
 * sees a token at all.
 */

type Messenger = "telegram" | "max";

type Entry = {
  token: SettingView;
  destination: string;
  enabled: boolean;
};

export type SyndicationState = Record<Messenger, Entry>;

type BlockProps = {
  messenger: Messenger;
  title: string;
  tokenLabel: string;
  destinationLabel: string;
  destinationPlaceholder: string;
  enabledLabel: string;
  hint: string;
  /** Request field names, which differ per messenger and are not derivable. */
  tokenField: string;
  destinationField: string;
  enabledField: string;
  /** Where the token comes from, for the "how do I get it" panel. */
  instructions?: { steps: string[]; linkLabel?: string; link?: string };
};

const BLOCKS: BlockProps[] = [
  {
    messenger: "telegram",
    title: "Telegram",
    tokenLabel: "Токен бота",
    destinationLabel: "Канал (юзернейм или ID)",
    destinationPlaceholder: "@eartnews или -1001234567890",
    enabledLabel: "Автопостинг в Telegram активен",
    hint: "Полный текст новости уходит в мессенджер вместе с обложкой.",
    tokenField: "telegramBotToken",
    destinationField: "telegramChannelId",
    enabledField: "telegramEnabled",
    instructions: {
      steps: [
        "Напишите @BotFather и отправьте /newbot — это создаёт бота.",
        "Скопируйте токен, который он выдаст.",
        "Добавьте бота в канал и сделайте его администратором с правом публикации.",
      ],
    },
  },
  {
    messenger: "max",
    title: "MAX",
    tokenLabel: "Токен бота / API-ключ",
    destinationLabel: "ID канала",
    destinationPlaceholder: "числовой идентификатор канала",
    enabledLabel: "Автопостинг в MAX активен",
    hint: "Требует верифицированного профиля на платформе MAX для партнёров.",
    tokenField: "maxBotToken",
    destinationField: "maxChatId",
    enabledField: "maxEnabled",
    instructions: {
      steps: [
        "Подключитесь к платформе MAX для партнёров (business.max.ru) и верифицируйте профиль.",
        "Создайте чат-бота — он должен пройти модерацию.",
        "Скопируйте токен в разделе настроек бота и укажите числовой ID канала.",
      ],
      linkLabel: "Документация MAX для разработчиков",
      link: "https://dev.max.ru/docs-api",
    },
  },
];

type TestState = { ok: boolean; message: string } | null;

export function SyndicationSettings({ initial }: { initial: SyndicationState }) {
  const [state, setState] = useState<SyndicationState>(initial);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState<Record<Messenger, boolean>>({
    telegram: initial.telegram.enabled,
    max: initial.max.enabled,
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [testing, setTesting] = useState<Record<string, string | null>>({});

  /**
   * Only the fields the editor actually touched are sent.
   *
   * A key field left empty does not clear the stored value — the same rule the API-key
   * form follows, and for the same reason: an editor who opens this page to change the
   * channel must not lose a working token by pressing Save. Clearing is a deliberate
   * action through the "Очистить" button.
   */
  const payload = useCallback((): Record<string, string> => {
    const body: Record<string, string> = {};

    for (const block of BLOCKS) {
      const token = tokens[block.messenger]?.trim();
      const destination = destinations[block.messenger]?.trim();

      if (token) body[block.tokenField] = token;
      if (destination) body[block.destinationField] = destination;
      // Always sent: unlike the others this one has a meaningful "off" value, and an
      // unchecked box that stayed unchecked would make the toggle impossible to turn off.
      body[block.enabledField] = String(enabled[block.messenger]);
    }

    return body;
  }, [tokens, destinations, enabled]);

  async function save() {
    const body = payload();
    const touched = Object.keys(tokens).some((name) => tokens[name]?.trim()) ||
      Object.keys(destinations).some((name) => destinations[name]?.trim());

    if (!touched) {
      setFormError("Введите токен или канал — галочки сохраняются всегда.");
      setSaved(null);
      return;
    }

    setSaving(true);
    setFormError(null);
    setErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/syndication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        syndication?: SyndicationState;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error ?? "Не удалось сохранить настройки.");
        return;
      }

      setSaved("Настройки интеграций сохранены и применяются при следующей публикации.");
      setTokens({});
      setDestinations({});

      /*
        Adopt the state the server re-read after the write. Only it knows whether an
        emptied field fell back to `.env` or to nothing, and rendering from local state
        would leave the page claiming a token is set when the fallback did not happen.
      */
      if (result.syndication) {
        const next = result.syndication;
        setState({
          telegram: {
            token: next.telegram.token,
            destination: next.telegram.destination,
            enabled: next.telegram.enabled,
          },
          max: {
            token: next.max.token,
            destination: next.max.destination,
            enabled: next.max.enabled,
          },
        });
        setEnabled({ telegram: next.telegram.enabled, max: next.max.enabled });
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  /** Drops the stored override so the `.env` value takes over again. */
  async function clear(messenger: Messenger) {
    const block = BLOCKS.find((entry) => entry.messenger === messenger);
    if (!block) return;

    setSaving(true);
    setFormError(null);
    setErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/syndication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An empty string is the documented way to drop the override.
        body: JSON.stringify({ [block.tokenField]: "" }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; syndication?: SyndicationState };

      if (!response.ok || !result.ok) {
        setFormError(result.error ?? "Не удалось очистить токен.");
        return;
      }

      setSaved("Токен удалён из базы. Если он есть в .env, используется он.");
      setTokens((current) => ({ ...current, [messenger]: "" }));

      if (result.syndication) {
        const entry = result.syndication[messenger];
        setState((current) => ({ ...current, [messenger]: { ...current[messenger], ...entry } }));
        setEnabled((current) => ({ ...current, [messenger]: entry.enabled }));
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * Two buttons rather than one, because the two questions differ.
   *
   * "Проверить токен" costs nothing and posts nothing. "Отправить в канал" really does
   * publish a short test note, which is the only way to find out that the channel id is
   * wrong — but it must be asked for explicitly, so it is a separate control.
   */
  async function test(messenger: Messenger, mode: "token" | "message") {
    const key = `${messenger}:${mode}`;
    setTesting((current) => ({ ...current, [key]: key }));
    setTests((current) => ({ ...current, [key]: null }));

    try {
      const destination =
        destinations[messenger]?.trim() || state[messenger].destination || "";

      const response = await fetch("/api/admin/syndication/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messenger,
          mode,
          token: tokens[messenger]?.trim() ?? "",
          destination,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };

      setTests((current) => ({
        ...current,
        [key]:
          result.ok === undefined
            ? { ok: false, message: result.error ?? "Проверка не удалась." }
            : { ok: Boolean(result.ok), message: result.message ?? "" },
      }));
    } catch (error) {
      setTests((current) => ({
        ...current,
        [key]: {
          ok: false,
          message: error instanceof Error ? error.message : "Не удалось выполнить проверку.",
        },
      }));
    } finally {
      setTesting((current) => ({ ...current, [key]: null }));
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 border border-neutral-300 bg-white p-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Интеграции и автопостинг
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Куда уходит материал вместе с обложкой при первой публикации. Хранятся в
            базе данных и применяются сразу — перезапуск не нужен.
          </p>
        </div>

        {BLOCKS.map((block) => {
          const name = block.messenger;
          const entry = state[name];
          const typed = tokens[name] ?? "";
          const destination = destinations[name] ?? "";
          const isShown = revealed[name] ?? false;

          return (
            <div key={name} className="space-y-2 border-t border-neutral-200 pt-4">
              <h3 className="text-sm font-semibold text-neutral-800">{block.title}</h3>

              <div className="space-y-1.5">
                <label htmlFor={block.tokenField} className="text-sm font-medium text-neutral-700">
                  {block.tokenLabel}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-56 flex-1">
                    <input
                      id={block.tokenField}
                      type={isShown ? "text" : "password"}
                      value={typed}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) =>
                        setTokens((all) => ({ ...all, [name]: event.target.value }))
                      }
                      placeholder={entry.token.isSet ? entry.token.masked : "не задан"}
                      aria-invalid={Boolean(errors[block.tokenField])}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 pr-10 font-mono text-sm outline-none",
                        "placeholder:text-neutral-400 focus:ring-2",
                        errors[block.tokenField]
                          ? "border-red-400 bg-red-50 focus:ring-red-200"
                          : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((all) => ({ ...all, [name]: !isShown }))}
                      aria-label={isShown ? "Скрыть токен" : "Показать токен"}
                      aria-pressed={isShown}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-700"
                    >
                      {isShown ? "скрыть" : "показать"}
                    </button>
                  </div>

                  {entry.token.isSet ? (
                    <button
                      type="button"
                      onClick={() => void clear(name)}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                    >
                      <X className="size-4" aria-hidden />
                      Очистить
                    </button>
                  ) : null}
                </div>

                {errors[block.tokenField] ? (
                  <p role="alert" className="text-xs text-red-600">
                    {errors[block.tokenField]}
                  </p>
                ) : null}

                <p className="text-xs text-neutral-500">
                  {entry.token.isSet ? (
                    <span className="text-neutral-700">
                      Сейчас задан: <span className="font-mono">{entry.token.masked}</span>{" "}
                      {entry.token.source === "database"
                        ? "(в базе данных)."
                        : "(из .env, в базе пусто)."}
                    </span>
                  ) : (
                    <span>Токен не задан — публикация в {block.title} пропускается.</span>
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={block.destinationField}
                  className="text-sm font-medium text-neutral-700"
                >
                  {block.destinationLabel}
                </label>
                <input
                  id={block.destinationField}
                  type="text"
                  value={destination}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setDestinations((all) => ({ ...all, [name]: event.target.value }))
                  }
                  placeholder={entry.destination || block.destinationPlaceholder}
                  aria-invalid={Boolean(errors[block.destinationField])}
                  className={cn(
                    "w-full rounded-md border px-3 py-2 font-mono text-sm outline-none",
                    "placeholder:text-neutral-400 focus:ring-2",
                    errors[block.destinationField]
                      ? "border-red-400 bg-red-50 focus:ring-red-200"
                      : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
                  )}
                />
                {errors[block.destinationField] ? (
                  <p role="alert" className="text-xs text-red-600">
                    {errors[block.destinationField]}
                  </p>
                ) : null}
                <p className="text-xs text-neutral-500">
                  {entry.destination ? (
                    <span>
                      Сейчас задан: <span className="font-mono">{entry.destination}</span>
                    </span>
                  ) : (
                    <span>Канал не задан.</span>
                  )}
                </p>
              </div>

              <label
                htmlFor={block.enabledField}
                className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900"
              >
                <input
                  id={block.enabledField}
                  type="checkbox"
                  checked={enabled[name]}
                  onChange={(event) =>
                    setEnabled((all) => ({ ...all, [name]: event.target.checked }))
                  }
                  className="size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700"
                />
                {block.enabledLabel}
              </label>

              <p className="pl-6 text-xs text-neutral-500">{block.hint}</p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void test(name, "token")}
                  disabled={testing[`${name}:token`] != null || saving}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                >
                  {testing[`${name}:token`] ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Plug className="size-4" aria-hidden />
                  )}
                  Проверить токен
                </button>

                <button
                  type="button"
                  onClick={() => void test(name, "message")}
                  disabled={testing[`${name}:message`] != null || saving}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                >
                  {testing[`${name}:message`] ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4" aria-hidden />
                  )}
                  Тестовая отправка
                </button>

                {tests[`${name}:token`] ? (
                  <p
                    role="status"
                    className={cn(
                      "flex items-start gap-1.5 text-xs",
                      tests[`${name}:token`]!.ok ? "text-green-700" : "text-red-600",
                    )}
                  >
                    {tests[`${name}:token`]!.ok ? (
                      <Check className="mt-px size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <X className="mt-px size-3.5 shrink-0" aria-hidden />
                    )}
                    {tests[`${name}:token`]!.message}
                  </p>
                ) : null}

                {tests[`${name}:message`] ? (
                  <p
                    role="status"
                    className={cn(
                      "flex items-start gap-1.5 text-xs",
                      tests[`${name}:message`]!.ok ? "text-green-700" : "text-red-600",
                    )}
                  >
                    {tests[`${name}:message`]!.ok ? (
                      <Check className="mt-px size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <X className="mt-px size-3.5 shrink-0" aria-hidden />
                    )}
                    {tests[`${name}:message`]!.message}
                  </p>
                ) : null}
              </div>

              {block.instructions ? (
                <details className="rounded-sm border border-neutral-200 bg-white">
                  <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900">
                    Как получить доступ в {block.title}?
                  </summary>
                  <ol className="space-y-1.5 border-t border-neutral-200 px-2 py-2 text-xs text-neutral-600">
                    {block.instructions.steps.map((step, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="font-mono text-neutral-400">{index + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  {block.instructions.link && block.instructions.linkLabel ? (
                    <p className="px-2 pb-2">
                      <a
                        href={block.instructions.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
                      >
                        {block.instructions.linkLabel}
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
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            Сохранить настройки интеграций
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
    </div>
  );
}