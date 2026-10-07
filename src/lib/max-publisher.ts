/**
 * Auto-repost of published articles to a MAX channel.
 *
 * The API shape is taken from the platform's own documentation rather than from
 * another messenger's, because MAX is not Telegram-compatible:
 *
 *   - host `platform-api2.max.ru` (`platform-api.max.ru` is the retiring name),
 *   - the token in an `Authorization` header, and passing it in a query parameter
 *     is explicitly no longer supported,
 *   - `POST /messages` for a message or a channel post, with `format: "html"`,
 *   - media is *not* posted to the message endpoint: `POST /uploads?type=image`
 *     returns a one-shot URL and a token, the bytes go to that URL as multipart,
 *     and the token is then referenced as `attachments[].payload.token`,
 *   - a 4000-character limit on `text`.
 *
 * The consequence of the two-step upload is that a freshly uploaded image may not be
 * processed yet; MAX answers `attachment.not.ready` and expects the sender to wait
 * and retry, which `sendWithAttachment` does.
 *
 * Graceful degradation is the design goal rather than an afterthought: with no token
 * configured — the normal state of an install that has not set MAX up — every entry
 * point returns a short "not configured" result and nothing is logged as an error.
 */

import { extensionFor, readCoverImage, siteUrl } from "@/lib/cover-image";
import { buildMessengerPost, planMaxPost } from "@/lib/messenger-post";
import { DEFAULT_SYNDICATION_ENABLED, parseEnabled } from "@/lib/settings-keys";

const MAX_API_BASE = "https://platform-api2.max.ru";

export type MaxArticle = {
  title: string;
  contentHtml: string;
  slug: string;
  categoryName?: string | null;
  coverImage?: string | null;
};

export type MaxConfig = {
  token: string;
  chatId: string;
  enabled: boolean;
};

export type MaxPublishResult = {
  ok: boolean;
  /** Id of the posted message, when MAX returned one. */
  messageId?: string | null;
  summary?: string;
  warning?: string;
  error?: string;
};

/**
 * Credentials, read from the settings table with `.env` behind them.
 *
 * Lazy import for the same reason as the Telegram publisher: `@/lib/settings` is
 * `server-only` and would throw at import time in a unit test.
 */
export async function maxConfig(): Promise<MaxConfig> {
  const { getSetting } = (await import("@/lib/settings")) as typeof import("@/lib/settings");

  const [token, chatId, enabled] = await Promise.all([
    getSetting("MAX_BOT_TOKEN"),
    getSetting("MAX_CHAT_ID"),
    getSetting("MAX_ENABLED"),
  ]);

  return {
    token: token.trim(),
    chatId: chatId.trim(),
    // Off by default, unlike Telegram: MAX needs a verified business profile before a
    // channel exists, so the common case is "not set up yet" rather than "set up but
    // paused", and defaulting it on would produce a warning on every article until
    // somebody found the checkbox.
    enabled: parseEnabled(enabled, DEFAULT_SYNDICATION_ENABLED.max),
  };
}

/**
 * The config lookup, replaceable — see `setTelegramConfigSource`.
 *
 * The default is the environment rather than `maxConfig`, for the same reason:
 * `maxConfig` reaches `@/lib/settings`, which is `server-only` and throws on import
 * outside a Server Component. A default that only worked in production would make
 * every unit test of this module need its own config injected.
 */
let configSource: () => Promise<MaxConfig> = async () => ({
  token: process.env.MAX_BOT_TOKEN?.trim() ?? "",
  chatId: process.env.MAX_CHAT_ID?.trim() ?? "",
  enabled: parseEnabled(process.env.MAX_ENABLED ?? "", DEFAULT_SYNDICATION_ENABLED.max),
});

/** Points the publisher at the settings table. Called once, from the action. */
export function setMaxConfigSource(resolve: () => Promise<MaxConfig> = maxConfig): void {
  configSource = resolve;
}

/** Test-only: restores the environment-based lookup. */
export function resetMaxConfigSource(): void {
  configSource = async () => ({
    token: process.env.MAX_BOT_TOKEN?.trim() ?? "",
    chatId: process.env.MAX_CHAT_ID?.trim() ?? "",
    enabled: parseEnabled(process.env.MAX_ENABLED ?? "", DEFAULT_SYNDICATION_ENABLED.max),
  });
}

/**
 * Whether an error is the CA trust problem rather than anything to do with the token.
 *
 * MAX's API is served with a certificate issued by the Russian Trusted CA of the
 * Ministry of Digital Development, which is in neither Node's bundled trust store nor
 * Ubuntu's `ca-certificates`. Measured on the workstation and on the VPS: `fetch`
 * fails before it sends a request, with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, against
 * a `*.max.ru` certificate issued by `Russian Trusted Sub CA`.
 *
 * Worth naming explicitly. The raw code says nothing an editor can act on and reads
 * like a broken token, so an operator would go hunting for a credential problem that
 * is not there. The remedy — install the Russian Trusted CA and point
 * `NODE_EXTRA_CA_CERTS` at it — is an operator decision, not something this process
 * should quietly make for itself.
 *
 * The code is looked for in `error.cause.code` as well as in the message: undici wraps
 * the TLS failure, and depending on the Node version the code is on either.
 */
export function isMaxCertificateError(error: unknown): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    (error as { cause?: unknown } | null)?.cause instanceof Error
      ? ((error as { cause: Error }).cause).message
      : "",
    (error as { cause?: { code?: string } } | null)?.cause?.code ?? "",
  ]
    .join(" ")
    .toLowerCase();

  /*
    Case-insensitive, because the two forms differ: undici surfaces OpenSSL's
    `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` as a code on `cause`, while a `tls.connect`
    or an older Node surfaces the lowercase prose "unable to get local issuer
    certificate". Matching only the code form would miss the second.
  */
  return [
    "unable_to_get_issuer_cert_locally",
    "unable_to_verify_leaf_signature",
    "self_signed_cert_in_chain",
    "depth_zero_self_signed_cert",
    "unable to get local issuer certificate",
    "self signed certificate in chain",
  ].some((needle) => text.includes(needle));
}

/** The sentence an operator needs, in place of an OpenSSL error code. */
export const MAX_CERTIFICATE_HINT =
  "сертификат MAX выпущен удостоверяющим центром Минцифры, которому нет в списке доверенных: " +
  "нужен Russian Trusted CA в NODE_EXTRA_CA_CERTS.";

/** Turns a caught error into the sentence the editor sees. */
export function describeMaxError(error: unknown): string {
  if (isMaxCertificateError(error)) return MAX_CERTIFICATE_HINT;
  return error instanceof Error ? error.message : "неизвестная ошибка MAX";
}

/**
 * Why a MAX operation did not happen.
 *
 * Deliberately a short sentence rather than an error: a missing token is the expected
 * state of most installs, and logging it as a failure would fill the console with
 * noise that hides the failures that matter.
 */
export function maxNotConfigured(config: MaxConfig): string | null {
  if (!config.token) return "MAX не настроен: задайте токен бота в разделе «Настройки» или в .env";
  if (!config.chatId) return "MAX не настроен: задайте идентификатор канала в разделе «Настройки» или в .env";
  if (!config.enabled) return "Автопостинг в MAX выключен в настройках.";
  return null;
}

function maxHeaders(token: string): HeadersInit {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

/** One JSON API call. Throws on a transport error or a non-2xx status. */
async function callMax<T>(
  config: MaxConfig,
  path: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const response = await fetch(`${MAX_API_BASE}${path}`, {
    method: "POST",
    headers: maxHeaders(config.token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();

  if (!response.ok) {
    // MAX reports the reason in a `code`/`message` pair; keeping both means a
    // misconfigured chat id is distinguishable from an expired token in the log.
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      if (parsed.code || parsed.message) {
        detail = [parsed.code, parsed.message].filter(Boolean).join(": ");
      }
    } catch {
      // Not JSON — the raw body is the only thing there is to report.
    }
    throw new Error(`MAX ${path}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Uploads the cover and returns the token to attach it by.
 *
 * Two calls, in this order: ask for a URL, then put the bytes on it. The URL is good
 * for exactly one file, so a second upload needs a second request.
 */
async function uploadCover(config: MaxConfig, coverImage: string): Promise<string> {
  const { bytes, contentType } = await readCoverImage(coverImage);

  const ticket = await callMax<{ url?: string; token?: string }>(
    config,
    "/uploads?type=image",
    {},
  );

  if (!ticket.url) {
    throw new Error("MAX не вернул URL для загрузки обложки");
  }

  const form = new FormData();
  form.append("data", new Blob([bytes], { type: contentType }), `cover${extensionFor(contentType) ?? ".jpg"}`);

  const uploaded = await fetch(ticket.url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploaded.ok) {
    throw new Error(`загрузка обложки в MAX не удалась: HTTP ${uploaded.status}`);
  }

  // The token from the first response is the one to attach by; a response that
  // omits it can still be usable only if the endpoint echoed a new one.
  const echoed = (await uploaded.json().catch(() => null)) as { token?: string } | null;
  const token = echoed?.token ?? ticket.token;
  if (!token) {
    throw new Error("MAX не вернул токен загруженной обложки");
  }
  return token;
}

type MaxMessageResponse = { message?: { body?: { mid?: string } } };

/** Posts one message, optionally with the cover attached. */
async function postMessage(
  config: MaxConfig,
  text: string,
  attachmentToken: string | null,
): Promise<{ messageId: string | null }> {
  const body = {
    text,
    // The article body is already escaped for an HTML-capable messenger; naming the
    // format is what stops MAX from rendering the escaped entities literally.
    format: "html",
    ...(attachmentToken
      ? { attachments: [{ type: "image", payload: { token: attachmentToken } }] }
      : {}),
  };

  const sent = await callMax<MaxMessageResponse>(
    config,
    `/messages?chat_id=${encodeURIComponent(config.chatId)}`,
    body,
  );

  return { messageId: sent.message?.body?.mid ?? null };
}

/**
 * Posts the message, retrying once if the cover is not processed yet.
 *
 * MAX documents `attachment.not.ready` as the expected answer to a message sent the
 * instant an upload finishes, and asks the sender to wait and try again with a longer
 * gap. One retry after a pause covers the common case; a second failure is reported
 * rather than retried in a loop, because a loop here would hold an article save open.
 */
async function sendWithAttachment(
  config: MaxConfig,
  text: string,
  attachmentToken: string | null,
): Promise<{ messageId: string | null }> {
  try {
    return await postMessage(config, text, attachmentToken);
  } catch (error) {
    const notReady =
      error instanceof Error &&
      (error.message.includes("attachment.not.ready") ||
        error.message.includes("file.not.processed"));

    if (!notReady || !attachmentToken) throw error;

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return postMessage(config, text, attachmentToken);
  }
}

/**
 * Publishes an article to the configured MAX channel.
 *
 * Never throws. A missing token is a short "not configured" result rather than an
 * error, because that is the normal state and an article must not be blocked by it.
 */
export async function publishArticleToMax(
  article: MaxArticle,
): Promise<MaxPublishResult> {
  try {
    const config = await configSource();
    const notConfigured = maxNotConfigured(config);
    if (notConfigured) return { ok: false, error: notConfigured };

    const post = buildMessengerPost({
      title: article.title,
      contentHtml: article.contentHtml,
      slug: article.slug,
      categoryName: article.categoryName,
      siteUrl: siteUrl(),
    });

    const plan = planMaxPost(post, { hasCover: Boolean(article.coverImage) });

    let attachmentToken: string | null = null;
    let warning: string | undefined;

    if (plan.attachCover && article.coverImage) {
      try {
        attachmentToken = await uploadCover(config, article.coverImage);
      } catch (error) {
        // The post is still worth sending without the picture.
        warning = `Обложка не отправлена: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`;
        console.warn(`[max] ${warning}`);
      }
    }

    const sent = await sendWithAttachment(config, plan.text, attachmentToken);

    return {
      ok: true,
      messageId: sent.messageId,
      summary: plan.truncated
        ? "MAX: анонс со ссылкой на полный текст."
        : attachmentToken
          ? "MAX: публикация с обложкой."
          : "MAX: публикация без обложки.",
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const message = describeMaxError(error);
    console.warn(`[max] публикация не выполнена: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * Sends a short note to the channel, to check a token without publishing a story.
 *
 * No image and no retry: this is a connectivity check, and it should not take longer
 * than the editor expects a button to take.
 */
export async function sendMaxTestMessage(
  config: MaxConfig,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!config.token) return { ok: false, error: "Токен бота не задан." };
  if (!config.chatId) return { ok: false, error: "Идентификатор канала не задан." };

  try {
    const sent = await postMessage(
      config,
      "Проверка связи: канал «Ё-новости» подключён. Это тестовое сообщение, новостей в нём нет.",
      null,
    );
    return {
      ok: true,
      message: sent.messageId
        ? `Сообщение отправлено, id ${sent.messageId}.`
        : "Сообщение отправлено.",
    };
  } catch (error) {
    const message = describeMaxError(error);
    console.warn(`[max] тестовая отправка не удалась: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * A cheap authenticated call, for the settings page's "test" button.
 *
 * `GET /me` returns the bot's own profile and posts nothing anywhere.
 */
export async function checkMaxToken(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: "Токен не задан." };

  try {
    const response = await fetch(`${MAX_API_BASE}/me`, {
      headers: { Authorization: token.trim() },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string; code?: string }
        | null;
      const detail = [body?.code, body?.message].filter(Boolean).join(": ");
      return {
        ok: false,
        message: `MAX отклонил токен: ${detail || `HTTP ${response.status}`}`,
      };
    }

    const body = (await response.json().catch(() => null)) as { username?: string } | null;
    return {
      ok: true,
      message: body?.username ? `Токен принят, бот @${body.username}.` : "Токен принят, MAX отвечает.",
    };
  } catch (error) {
    if (isMaxCertificateError(error)) {
      return { ok: false, message: `MAX недоступен: ${MAX_CERTIFICATE_HINT}` };
    }
    return {
      ok: false,
      message: `Не удалось обратиться к MAX: ${
        error instanceof Error ? error.message : "сетевая ошибка"
      }`,
    };
  }
}