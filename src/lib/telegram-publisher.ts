/**
 * Auto-repost of published articles to a Telegram channel.
 *
 * Everything about *what* goes into the message and how it is split lives in
 * messenger-post.ts, which is pure and unit-tested. This module is the transport:
 * it resolves credentials, reads the cover off disk, calls the Bot API and converts
 * whatever comes back into a result the caller can report.
 *
 * Two properties matter more than anything else here:
 *
 *  - It never throws. An article that reached the database must not be lost because a
 *    messenger was slow, rate-limited, or has no token configured.
 *  - It never logs a token. Every message is prefixed `[telegram]` and carries the
 *    method name and the API's own description, which never contains the token.
 */

import { extensionFor, readCoverImage, siteUrl } from "@/lib/cover-image";
import { planTelegramPost, buildMessengerPost, cutForReading } from "@/lib/messenger-post";
import { DEFAULT_SYNDICATION_ENABLED, parseEnabled } from "@/lib/settings-keys";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramArticle = {
  title: string;
  /** The article body as stored, editor markup and all. */
  contentHtml: string;
  slug: string;
  categoryName?: string | null;
  coverImage?: string | null;
};

export type TelegramConfig = {
  token: string;
  channelId: string;
  enabled: boolean;
};

export type TelegramPublishResult = {
  ok: boolean;
  /** Id of the first message that landed, for the operator to look it up by. */
  messageId?: string | null;
  /** One line describing what was sent, for the editor's toast. */
  summary?: string;
  /** Set when the post went out without something it should have had. */
  warning?: string;
  error?: string;
};

type TelegramEnvelope = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  result?: { message_id?: number };
};

/**
 * Credentials, read from the settings table with `.env` behind them.
 *
 * `getSetting` already resolves database-then-environment, and the key names are the
 * environment variable names, so the fallback the task asks for needs no code here —
 * only a decision about what an absent value means.
 *
 * Lazy import rather than a module-scope one: `@/lib/settings` is `server-only` and
 * throws the moment it is loaded outside a React Server Component, which is what the
 * unit tests do.
 */
export async function telegramConfig(): Promise<TelegramConfig> {
  const { getSetting } = (await import("@/lib/settings")) as typeof import("@/lib/settings");

  const [token, channelId, enabled] = await Promise.all([
    getSetting("TELEGRAM_BOT_TOKEN"),
    getSetting("TELEGRAM_CHANNEL_ID"),
    getSetting("TELEGRAM_ENABLED"),
  ]);

  return {
    token: token.trim(),
    channelId: channelId.trim(),
    // Absent means "not configured either way", so the default decides — and the
    // default is on for Telegram: a channel that was set up and then had its token
    // pasted should syndicate without anyone also finding a checkbox.
    enabled: parseEnabled(enabled, DEFAULT_SYNDICATION_ENABLED.telegram),
  };
}

/**
 * The config lookup, replaceable.
 *
 * The settings service is `server-only`, so importing it eagerly would make this
 * module unimportable from a test that stubs `fetch`. Same arrangement as
 * `setVkTokenSource`: the production path installs the settings lookup, tests leave it.
 */
let configSource: () => Promise<TelegramConfig> = async () => {
  // The default is the environment, not the settings table, for the same reason
  // `resetVkTokenSource` is: it must be reachable from a plain Node process where
  // `@/lib/settings` throws on import. Calling `telegramConfig` here would work in
  // production and break every unit test that does not inject its own config.
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim() ?? "";
  return {
    token,
    channelId,
    enabled: parseEnabled(
      process.env.TELEGRAM_ENABLED ?? "",
      DEFAULT_SYNDICATION_ENABLED.telegram,
    ),
  };
};

/** Points the publisher at the settings table. Called once, from the action. */
export function setTelegramConfigSource(
  resolve: () => Promise<TelegramConfig> = telegramConfig,
): void {
  configSource = resolve;
}

/** Test-only: restores the environment-based lookup. */
export function resetTelegramConfigSource(): void {
  setTelegramConfigSource(
    async () => ({
      token: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
      channelId: process.env.TELEGRAM_CHANNEL_ID?.trim() ?? "",
      enabled: parseEnabled(
        process.env.TELEGRAM_ENABLED ?? "",
        DEFAULT_SYNDICATION_ENABLED.telegram,
      ),
    }),
  );
}

/**
 * Whether an error is "the host cannot reach Telegram" rather than "the token is bad".
 *
 * Measured on the production VPS: TCP 443 to api.telegram.org does not complete, so
 * curl reports `ETIMEDOUT` and undici reports `UND_ERR_CONNECT_TIMEOUT`. Without this
 * classification the editor sees "fetch failed", which reads as a broken credential
 * and sends an operator to re-paste a perfectly good token.
 */
export function isTelegramUnreachable(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    (error as { cause?: unknown } | null)?.cause instanceof Error
      ? ((error as { cause: Error }).cause).message
      : "",
    (error as { cause?: { code?: string } } | null)?.cause?.code ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return [
    "etimedout",
    "und_err_connect_timeout",
    "econnrefused",
    "enotfound",
    "econnreset",
    "network is unreachable",
  ].some((needle) => text.includes(needle));
}

/** The sentence an operator needs, in place of a bare "fetch failed". */
export const TELEGRAM_UNREACHABLE_HINT =
  "Telegram недоступен с этого сервера: соединение с api.telegram.org не устанавливается.";

/** Turns a caught error into the sentence the editor sees. */
export function describeTelegramError(error: unknown): string {
  if (isTelegramUnreachable(error)) return TELEGRAM_UNREACHABLE_HINT;
  return error instanceof Error ? error.message : "сетевая ошибка Telegram";
}

/**
 * One Bot API call. Rejects on a transport error or on `ok: false`.
 *
 * Takes the body already built rather than a payload object, because the two methods
 * use two different encodings: `sendPhoto` is multipart and `sendMessage` is JSON.
 * `FormData` carries its own `Content-Type` with a boundary, so a header set here
 * would break it — which is why the JSON flag, not a shared header, decides.
 */
async function callTelegram<T>(
  token: string,
  method: string,
  init: { json?: unknown; form?: FormData },
): Promise<T> {
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    ...(init.form
      ? { body: init.form }
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.json ?? {}),
        }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();

  let parsed: TelegramEnvelope;
  try {
    parsed = JSON.parse(text) as TelegramEnvelope;
  } catch {
    // A non-JSON body from an edge proxy is not a Telegram error and has no
    // `description`; reporting the status keeps the failure readable.
    throw new Error(`Telegram ${method}: HTTP ${response.status}, ответ не JSON`);
  }

  // Telegram answers 200 with `ok: false` for most failures, so the status alone
  // would report a rejected token as a delivered message.
  if (!response.ok || parsed.ok === false) {
    throw new Error(
      `Telegram ${method}: ${parsed.description ?? `HTTP ${response.status}`}${
        parsed.error_code ? ` (${parsed.error_code})` : ""
      }`,
    );
  }

  return parsed as T;
}

/** Sends the cover with the text as its caption. */
async function sendPhoto(
  config: TelegramConfig,
  coverImage: string,
  caption: string | null,
): Promise<string | null> {
  const { bytes, contentType } = await readCoverImage(coverImage);

  const form = new FormData();
  form.append("chat_id", config.channelId);
  form.append("parse_mode", "HTML");
  // The filename keeps the real extension and the blob the real type, so a WebP cover
  // is not uploaded claiming to be a JPEG.
  form.append("photo", new Blob([bytes], { type: contentType }), `cover${extensionFor(contentType) ?? ".jpg"}`);
  if (caption) form.append("caption", caption);

  const sent = await callTelegram<TelegramEnvelope>(config.token, "sendPhoto", { form });
  return sent.result?.message_id != null ? String(sent.result.message_id) : null;
}

/** Sends the text on its own. */
async function sendMessage(config: TelegramConfig, text: string): Promise<string | null> {
  const sent = await callTelegram<TelegramEnvelope>(config.token, "sendMessage", {
    json: {
      chat_id: config.channelId,
      text,
      parse_mode: "HTML",
      // The post already ends with its own credit line. Telegram's automatic preview
      // card would render that URL a second time, below it, as a separate block.
      disable_web_page_preview: true,
    },
  });
  return sent.result?.message_id != null ? String(sent.result.message_id) : null;
}

/** Why a publish did not happen, as a sentence an editor can act on. */
function notConfiguredError(config: TelegramConfig): string {
  if (!config.token) return "Telegram не настроен: задайте токен бота в разделе «Настройки» или в .env";
  if (!config.channelId) {
    return "Telegram не настроен: задайте канал (@юзернейм или -100…) в разделе «Настройки» или в .env";
  }
  if (!config.enabled) return "Автопостинг в Telegram выключен в настройках.";
  return "Telegram не настроен.";
}

/**
 * Publishes an article to the configured channel.
 *
 * Never throws. Returns `ok: false` with a reason for every failure, including a
 * missing cover: the post is still worth publishing without the picture, exactly as
 * the VK path already does, so a broken image file costs a warning and not a post.
 */
export async function publishArticleToTelegram(
  article: TelegramArticle,
): Promise<TelegramPublishResult> {
  try {
    const config = await configSource();

    if (!config.token || !config.channelId || !config.enabled) {
      return { ok: false, error: notConfiguredError(config) };
    }

    const post = buildMessengerPost({
      title: article.title,
      contentHtml: article.contentHtml,
      slug: article.slug,
      categoryName: article.categoryName,
      siteUrl: siteUrl(),
    });

    const plan = planTelegramPost(post, { hasCover: Boolean(article.coverImage) });
    let warning: string | undefined;
    let firstMessageId: string | null = null;
    let sent = 0;

    for (const step of plan.steps) {
      if (step.kind === "photo") {
        // Only reached when a cover exists; `planTelegramPost` was told so above.
        const cover = article.coverImage;
        if (!cover) continue;

        try {
          firstMessageId ??= await sendPhoto(config, cover, step.caption);
          sent += 1;
        } catch (error) {
          warning = `Обложка не отправлена: ${
            error instanceof Error ? error.message : "неизвестная ошибка"
          }`;
          console.warn(`[telegram] ${warning}`);
        }
        continue;
      }

      firstMessageId ??= await sendMessage(config, step.text);
      sent += 1;
    }

    /*
      A caption-mode plan carries the text *inside* the photo step, so a cover that
      fails to upload leaves nothing delivered at all — the story would silently
      never reach the channel. Sending the text on its own is the same degradation
      the VK path makes when a cover upload fails.
    */
    if (sent === 0) {
      const fallback = plan.truncated ? cutForReading(post) : post.text;
      try {
        firstMessageId = await sendMessage(config, fallback);
        sent = 1;
      } catch (error) {
        return {
          ok: false,
          error: `Telegram не принял публикацию: ${
            error instanceof Error ? error.message : "неизвестная ошибка"
          }`,
        };
      }
    }

    const summary =
      plan.mode === "caption"
        ? `Telegram: одно сообщение с обложкой${plan.truncated ? ", текст обрезан" : ""}.`
        : plan.mode === "truncated"
          ? "Telegram: обложка и анонс со ссылкой на полный текст."
          : plan.mode === "split"
            ? "Telegram: обложка и текст двумя сообщениями."
            : "Telegram: текст без обложки.";

    return {
      ok: true,
      messageId: firstMessageId,
      summary,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const message = describeTelegramError(error);
    console.warn(`[telegram] публикация не выполнена: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * Sends a short note to the channel, to check a token without publishing a story.
 *
 * Does not go through `planTelegramPost`: there is no article, so there is nothing to
 * split, and a test that measured the limits would prove nothing about a token.
 */
export async function sendTelegramTestMessage(
  config: TelegramConfig,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!config.token) return { ok: false, error: "Токен бота не задан." };
  if (!config.channelId) return { ok: false, error: "Канал не задан." };

  try {
    const id = await sendMessage(
      config,
      "Проверка связи: канал «Ё-новости» подключён. Это тестовое сообщение, новостей в нём нет.",
    );
    return { ok: true, message: id ? `Сообщение отправлено, id ${id}.` : "Сообщение отправлено." };
  } catch (error) {
    const message = describeTelegramError(error);
    console.warn(`[telegram] тестовая отправка не удалась: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * A cheap authenticated call, for the settings page's "test" button when the editor
 * only wants to know whether the token itself is valid.
 *
 * `getMe` is the standard choice: it returns the bot's own name, costs nothing, and
 * does not post anything into a channel.
 */
export async function checkTelegramToken(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: "Токен не задан." };

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token.trim()}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await response.json().catch(() => null)) as TelegramEnvelope | null;

    if (!response.ok || parsed?.ok === false) {
      return {
        ok: false,
        message: `Telegram отклонил токен: ${parsed?.description ?? `HTTP ${response.status}`}`,
      };
    }

    const name = (parsed?.result as { username?: string } | undefined)?.username;
    return {
      ok: true,
      message: name ? `Токен принят, бот @${name}.` : "Токен принят, Telegram отвечает.",
    };
  } catch (error) {
    if (isTelegramUnreachable(error)) {
      return { ok: false, message: TELEGRAM_UNREACHABLE_HINT };
    }
    return {
      ok: false,
      message: `Не удалось обратиться к Telegram: ${
        error instanceof Error ? error.message : "сетевая ошибка"
      }`,
    };
  }
}