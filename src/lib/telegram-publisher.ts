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
 *
 * The API root and the proxy exist because `api.telegram.org` is not always
 * reachable. Measured on this project's VPS: TCP 443 to that host never completes
 * (curl reports ETIMEDOUT), so every publish failed at the connection with no
 * Telegram error to report. The two escape hatches are an alternative base URL
 * (a reverse proxy, a Cloudflare Worker) and an outbound proxy.
 */

import { extensionFor, readCoverImage, siteUrl } from "@/lib/cover-image";
import { planTelegramPost, buildMessengerPost, cutForReading } from "@/lib/messenger-post";
import { DEFAULT_SYNDICATION_ENABLED, parseEnabled } from "@/lib/settings-keys";

/** The official root. Used when no alternative is configured. */
export const DEFAULT_TELEGRAM_API_ROOT = "https://api.telegram.org";

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
  /** Alternative Bot API root; empty means the official one. */
  apiRoot: string;
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

  const [token, channelId, enabled, apiRoot] = await Promise.all([
    getSetting("TELEGRAM_BOT_TOKEN"),
    getSetting("TELEGRAM_CHANNEL_ID"),
    getSetting("TELEGRAM_ENABLED"),
    getSetting("TELEGRAM_API_ROOT"),
  ]);

  return {
    token: token.trim(),
    channelId: channelId.trim(),
    // Absent means "not configured either way", so the default decides — and the
    // default is on for Telegram: a channel that was set up and then had its token
    // pasted should syndicate without anyone also finding a checkbox.
    enabled: parseEnabled(enabled, DEFAULT_SYNDICATION_ENABLED.telegram),
    apiRoot: apiRoot.trim(),
  };
}

/** The base the methods are appended to, with any trailing slash removed. */
export function telegramApiBase(config: TelegramConfig): string {
  const configured = config.apiRoot.trim();
  return (configured || DEFAULT_TELEGRAM_API_ROOT).replace(/\/+$/, "");
}

/**
 * The outbound proxy, from the environment only.
 *
 * Deliberately not a settings field, unlike the API root. A proxy URL usually carries
 * credentials, and this project's rule for a credential is that the server-side value
 * is the trust boundary — the same reason VK_COMMUNITY_ID is env-only. The API root is
 * editable from /admin because it is a destination, not a secret; the proxy is a secret.
 *
 * Empty means no proxy, which is the normal case.
 */
export function telegramProxy(): string {
  return process.env.TELEGRAM_PROXY?.trim() ?? "";
}

/**
 * One HTTP call, through the proxy when one is configured.
 *
 * Two things here are measured rather than assumed, and both were wrong in the
 * obvious implementation:
 *
 *  1. The dispatcher cannot be handed to the global `fetch`. Passing a `ProxyAgent`
 *     from the top-level `undici` package to Node's global fetch fails with
 *     `UND_ERR_INVALID_ARG`, because the global is a different undici instance and
 *     rejects a dispatcher built by another one. So the proxied path uses
 *     `undici.fetch` from the same import that built the agent.
 *  2. A fresh `ProxyAgent` per call would open a new pool each time. The agent is
 *     cached by URL, which is the documented usage and keeps this process from
 *     accumulating sockets.
 *
 * Both paths return a standard `Response` with the same shape, so callers do not know
 * which one ran.
 */
type UndiciModule = {
  fetch: (url: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
  ProxyAgent: new (url: string) => { close?: () => Promise<void> };
};

let undiciModule: Promise<UndiciModule> | null = null;
const proxyAgents = new Map<string, unknown>();

async function loadUndici(): Promise<UndiciModule> {
  undiciModule ??= import("undici") as unknown as Promise<UndiciModule>;
  return undiciModule;
}

async function telegramFetch(url: string, init: RequestInit): Promise<Response> {
  const proxy = telegramProxy();
  if (!proxy) return fetch(url, init);

  const undici = await loadUndici();
  let dispatcher = proxyAgents.get(proxy);
  if (!dispatcher) {
    dispatcher = new undici.ProxyAgent(proxy);
    proxyAgents.set(proxy, dispatcher);
  }

  return undici.fetch(url, { ...init, dispatcher });
}

/** Test-only: drops cached agents so a suite can switch proxies between cases. */
export function resetTelegramProxyCache(): void {
  for (const agent of proxyAgents.values()) {
    void (agent as { close?: () => Promise<void> }).close?.();
  }
  proxyAgents.clear();
}

/**
 * The config lookup, replaceable.
 *
 * The settings service is `server-only`, so importing it eagerly would make this
 * module unimportable from a test that stubs `fetch`. Same arrangement as
 * `setVkTokenSource`: the production path installs the settings lookup, tests leave it.
 *
 * The default is the environment rather than `telegramConfig`, and it has to be: it
 * must be reachable from a plain Node process where `@/lib/settings` throws on import.
 * A default that only worked in production would make every unit test of this module
 * inject its own config.
 */
function envTelegramConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    channelId: process.env.TELEGRAM_CHANNEL_ID?.trim() ?? "",
    enabled: parseEnabled(
      process.env.TELEGRAM_ENABLED ?? "",
      DEFAULT_SYNDICATION_ENABLED.telegram,
    ),
    apiRoot: process.env.TELEGRAM_API_ROOT?.trim() ?? "",
  };
}

let configSource: () => Promise<TelegramConfig> = async () => envTelegramConfig();

/** Points the publisher at the settings table. Called once, from the action. */
export function setTelegramConfigSource(
  resolve: () => Promise<TelegramConfig> = telegramConfig,
): void {
  configSource = resolve;
}

/** Test-only: restores the environment-based lookup. */
export function resetTelegramConfigSource(): void {
  setTelegramConfigSource(async () => envTelegramConfig());
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

/**
 * The sentence an operator needs, in place of a bare "fetch failed".
 *
 * Host-neutral on purpose. It used to name api.telegram.org, which was accurate while
 * that was the only address this code could use and is wrong now that the API root is
 * configurable: a failure against a reverse proxy would have blamed a host that was
 * never contacted. Callers that know the address append it.
 */
export const TELEGRAM_UNREACHABLE_HINT = "Telegram недоступен: соединение не устанавливается.";

/** Turns a caught error into the sentence the editor sees. */
export function describeTelegramError(error: unknown, apiBase?: string): string {
  if (!isTelegramUnreachable(error)) {
    return error instanceof Error ? error.message : "сетевая ошибка Telegram";
  }
  return apiBase ? `${TELEGRAM_UNREACHABLE_HINT} Адрес: ${apiBase}` : TELEGRAM_UNREACHABLE_HINT;
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
  apiRoot: string,
): Promise<T> {
  const url = `${apiRoot}/bot${token}/${method}`;

  const response = await telegramFetch(url, {
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
    // `description`; the body is logged so a proxy's error page is visible rather than
    // reduced to a status code.
    console.warn(
      `[telegram] ${method}: HTTP ${response.status}, ответ не JSON — ${text.slice(0, 500)}`,
    );
    throw new Error(`Telegram ${method}: HTTP ${response.status}, ответ не JSON`);
  }

  // Telegram answers 200 with `ok: false` for most failures, so the status alone
  // would report a rejected token as a delivered message.
  if (!response.ok || parsed.ok === false) {
    /*
      The whole answer is logged, not a summary of it.

      This line is what was missing when a long post reached the channel as a bare
      picture: Telegram refused the text with "can't parse entities", the publisher
      threw, and all an operator could find was a sentence that named neither the method
      nor the reason. `description` and `error_code` are the fields the Bot API
      documents; the raw body is kept for when it answers with something else.
    */
    console.warn(
      `[telegram] ${method} отклонён: ${parsed.description ?? `HTTP ${response.status}`}${
        parsed.error_code ? ` (${parsed.error_code})` : ""
      } — ответ: ${text.slice(0, 500)}`,
    );
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

  const sent = await callTelegram<TelegramEnvelope>(
    config.token,
    "sendPhoto",
    { form },
    telegramApiBase(config),
  );
  return sent.result?.message_id != null ? String(sent.result.message_id) : null;
}

/** Sends the text on its own. */
async function sendMessage(config: TelegramConfig, text: string): Promise<string | null> {
  const sent = await callTelegram<TelegramEnvelope>(
    config.token,
    "sendMessage",
    {
      json: {
        chat_id: config.channelId,
        text,
        parse_mode: "HTML",
        // The post already ends with its own credit line. Telegram's automatic preview
        // card would render that URL a second time, below it, as a separate block.
        disable_web_page_preview: true,
      },
    },
    telegramApiBase(config),
  );
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
          /*
            `await` first, then `??=`, and the order is the whole point of this shape.

            Written the obvious way — `firstMessageId ??= await sendPhoto(…)` — the
            assignment operator skips its right-hand side once an id already exists, so
            the *second* step of a plan was never sent at all. For every post longer than
            a caption that meant: the cover went out, the `sendMessage` carrying the text
            was never called, and the channel showed a picture with nothing under it.
            That is the reported fault, and it lived in one operator.
          */
          const id = await sendPhoto(config, cover, step.caption);
          firstMessageId ??= id;
          sent += 1;
        } catch (error) {
          warning = `Обложка не отправлена: ${
            error instanceof Error ? error.message : "неизвестная ошибка"
          }`;
          console.warn(`[telegram] ${warning}`);
        }
        continue;
      }

      const id = await sendMessage(config, step.text);
      firstMessageId ??= id;
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

    const textMessageCount = plan.steps.filter((step) => step.kind === "text").length;
    const summary =
      plan.mode === "caption"
        ? "Telegram: одно сообщение с обложкой."
        : plan.mode === "truncated"
          ? "Telegram: обложка и анонс со ссылкой на полный текст."
          : plan.mode === "split"
            ? "Telegram: обложка и текст двумя сообщениями."
            : plan.mode === "chunks"
              ? `Telegram: обложка и текст ${textMessageCount} сообщениями.`
              : "Telegram: текст без обложки.";

    return {
      ok: true,
      messageId: firstMessageId,
      summary,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const message = describeTelegramError(error, await safeApiBase());
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
    const message = describeTelegramError(error, telegramApiBase(config));
    console.warn(`[telegram] тестовая отправка не удалась: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * A cheap authenticated call, for the settings page's "test" button when the editor
 * only wants to know whether the token itself is valid.
 *
 * `getMe` is the standard choice: it returns the bot's own name, costs nothing, and
 * does not post anything into a channel. It goes through the same API root and proxy
 * as a publish, so a token that works here works there.
 */
export async function checkTelegramToken(
  config: TelegramConfig,
): Promise<{ ok: boolean; message: string }> {
  const token = config.token.trim();
  if (!token) return { ok: false, message: "Токен не задан." };

  const base = telegramApiBase(config);

  try {
    const response = await telegramFetch(`${base}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await response.json().catch(() => null)) as TelegramEnvelope | null;

    if (!response.ok || parsed?.ok === false) {
      return {
        ok: false,
        // The address is named here too, not only on the network-error path: a 404 from
        // a reverse proxy that forwards nothing looks exactly like a rejected token, and
        // "который адрес спросили" is the first thing an operator needs to know.
        message: `Telegram отклонил токен: ${parsed?.description ?? `HTTP ${response.status}`} (адрес: ${base})`,
      };
    }

    const name = (parsed?.result as { username?: string } | undefined)?.username;
    return {
      ok: true,
      message: name
        ? `Токен принят, бот @${name} (${describeApiRoot(base)}).`
        : `Токен принят, Telegram отвечает (${describeApiRoot(base)}).`,
    };
  } catch (error) {
    if (isTelegramUnreachable(error)) {
      return { ok: false, message: `${TELEGRAM_UNREACHABLE_HINT} Адрес: ${base}` };
    }
    return {
      ok: false,
      message: `Не удалось обратиться к Telegram (${base}): ${
        error instanceof Error ? error.message : "сетевая ошибка"
      }`,
    };
  }
}

/**
 * The API base, resolved without failing.
 *
 * Only for composing an error message: if the settings lookup itself is what failed,
 * the message must still be produced rather than the reporter throwing.
 */
async function safeApiBase(): Promise<string> {
  try {
    return telegramApiBase(await configSource());
  } catch {
    return DEFAULT_TELEGRAM_API_ROOT;
  }
}

/**
 * Names the endpoint in a way that tells the official root apart from a stand-in.
 *
 * Worth the few lines: "Telegram отвечает" is ambiguous once the API root is
 * configurable — a reverse proxy answering 200 to everything would read as success.
 */
export function describeApiRoot(base: string): string {
  return base === DEFAULT_TELEGRAM_API_ROOT ? "официальный адрес" : `свой адрес ${base}`;
}

export type TelegramPingResult = {
  ok: boolean;
  /** The URL that was actually requested, after the root was resolved. */
  url: string;
  /** Real HTTP status of the response, or null when the request never completed. */
  status: number | null;
  /** Round-trip time in milliseconds. */
  ms: number;
  /** Whether the request went through a proxy. */
  viaProxy: boolean;
  message: string;
};

/**
 * Reaches the configured API root and reports what came back.
 *
 * Deliberately a plain GET of the root with no token: this answers "can this host talk
 * to that endpoint at all", which is the question that failed on this project's VPS,
 * and it answers it without sending a credential. A 404 or a 401 from Telegram is a
 * *success* here and is reported as reachable — the point is that something answered.
 *
 * The response time is measured around the request, so a proxy that silently drops the
 * connection shows up as a long duration followed by an error rather than as silence.
 */
export async function pingTelegramEndpoint(
  config: TelegramConfig,
): Promise<TelegramPingResult> {
  const base = telegramApiBase(config);
  const url = `${base}/`;
  const viaProxy = telegramProxy().length > 0;
  const started = Date.now();

  try {
    const response = await telegramFetch(url, {
      method: "GET",
      // Read-only and cacheable in no way that matters; don't let a CDN in front of a
      // reverse proxy answer from cache and make a dead upstream look healthy.
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const ms = Date.now() - started;

    return {
      ok: true,
      url,
      status: response.status,
      ms,
      viaProxy,
      message: `Эндпоинт ответил HTTP ${response.status} за ${ms} мс${
        viaProxy ? " (через прокси)" : ""
      }.`,
    };
  } catch (error) {
    const ms = Date.now() - started;

    const reason = isTelegramUnreachable(error)
      ? TELEGRAM_UNREACHABLE_HINT
      : error instanceof Error
        ? error.message
        : "сетевая ошибка";

    return {
      ok: false,
      url,
      status: null,
      ms,
      viaProxy,
      message: `Эндпоинт недоступен (${url}): ${reason}${
        viaProxy ? " Прокси задан в TELEGRAM_PROXY." : ""
      }`,
    };
  }
}