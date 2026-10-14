/**
 * Рассылка пуш-уведомлений читателям приложения через RuStore Push API.
 *
 * **Один запрос — один токен.** Батч-эндпоинта у RuStore нет: документация метода
 * (`POST {root}/{project_id}/messages:send`) принимает в теле одно поле `token`. «Пакетом» здесь
 * поэтому называется не один большой запрос, а пачка одновременных: токены идут группами по
 * `PUSH_CONCURRENCY`, и волна не превращается в тысячу параллельных соединений.
 *
 * **Пейлоад — data-only.** Раздел `data` уходит как есть, а `notification` не заполняется: так
 * решает приложение, каким каналом, иконкой и важностью показать новость, и так клик открывает
 * саму статью, а не главную. Документация допускает такое: сообщение валидно, если `data`
 * непустой, а `notification` и `android` могут отсутствовать.
 *
 * **Удаление токенов — самая опасная часть, и она сознательно недоверчива.** Удалённый токен
 * не вернётся: устройство зарегистрируется заново только при следующем запуске приложения. А
 * отличить «токен мёртв» от «мы стучимся не туда» по одному ответу нельзя: и истёкший токен, и
 * неверный ID проекта отвечают `404 NOT_FOUND` с одинаковым текстом «Requested entity was not
 * found». Поэтому удаляются только два случая, и оба — с доказательством:
 *
 *  - `INVALID_ARGUMENT` с текстом про registration/push token: платформа называет виновником
 *    сам токен, и это документированный пример невалидного токена;
 *  - `404/NOT_FOUND/UNREGISTERED` — **но только если в этом же прогоне хоть один токен получил
 *    ответ «отправлено»**. Это доказательство, что адрес и сервисный токен верны, и что `404`
 *    относится к устройству, а не к нашему URL.
 *
 * Если доказательства нет, токен остаётся в базе, а в отчёт уходит предупреждение о
 * конфигурации. Лишний мёртвый токен стоит одного неудачного запроса на рассылку; стёртая база
 * подписчиков не стоит ничего, потому что её не вернуть.
 *
 * Модуль никогда не бросает: провал рассылки не должен откатывать публикацию материала.
 */

import { siteUrl } from "@/lib/cover-image";
import { SyndicationHttpError, isRetryableStatus, withRetry } from "@/lib/syndication/retry";

/**
 * Каждой строке этого модуля в логе предшествует этот префикс.
 *
 * Не украшение: `grep '\[push\]'` — это вся история рассылки, как `[vk]` и `[telegram]` для
 * своих каналов. Без префикса строки тонут среди логов отдачи страниц.
 */
export const PUSH_LOG_PREFIX = "[push]";

/** Корень API. ID проекта подставляется в путь. */
export const RUSTORE_PUSH_API_ROOT = "https://vkpns.rustore.ru/v1/projects";

/** Сколько отправок идёт одновременно. */
export const PUSH_CONCURRENCY = 8;

/**
 * Сколько токенов берётся за один прогон.
 *
 * Потолок нужен не серверу, а публикации: рассылка запускается из действия редактора, и она не
 * имеет права задерживать ответ на сохранение на минуты. Остаток токенов не теряется — при
 * следующей «молнии» они попадут в выборку снова, начиная с самых старых.
 */
export const PUSH_MAX_TOKENS = 2_000;

/** Предел тела уведомления: дальше Android всё равно показывает многоточие. */
export const PUSH_BODY_MAX = 160;

/** Предел, который документация ставит на всё сообщение. */
export const PUSH_MESSAGE_BYTE_LIMIT = 4_096;

/** Сколько попыток на один токен. Совпадает с остальными каналами — общий `withRetry`. */
const PUSH_ATTEMPTS = 3;

export type RustorePushConfig = {
  /** ID проекта из RuStore Консоль → Push-уведомления → Проекты. */
  projectId: string;
  /** Сервисный токен оттуда же. Секрет: живёт в окружении, а не в базе настроек. */
  serviceToken: string;
};

/**
 * Настройки рассылки — только из окружения.
 *
 * Не через `getSetting`, в отличие от токенов ВК, Telegram и MAX, и это осознанно: сервисный
 * токен RuStore даёт право будить всех читателей приложения разом, и в базе он оказался бы
 * доступен любой ошибке в маршруте настроек. Тот же выбор сделан для `VK_COMMUNITY_ID` и
 * `TELEGRAM_PROXY` — секрет, у которого нет причины быть редактируемым из админки.
 */
export function rustorePushConfig(): RustorePushConfig {
  return {
    projectId: process.env.RUSTORE_PUSH_PROJECT_ID?.trim() ?? "",
    serviceToken: process.env.RUSTORE_SERVICE_TOKEN?.trim() ?? "",
  };
}

/** Чего не хватает для рассылки, словами для редактора. Пустая строка — всё на месте. */
export function pushConfigProblem(config: RustorePushConfig): string {
  if (!config.projectId) {
    return "Рассылка не настроена: задайте RUSTORE_PUSH_PROJECT_ID (ID проекта из RuStore Консоль).";
  }
  if (!config.serviceToken) {
    return "Рассылка не настроена: задайте RUSTORE_SERVICE_TOKEN (сервисный токен из RuStore Консоль).";
  }
  return "";
}

export type PushArticle = {
  /** Для лога: рассылка, которая сломалась, должна быть находима. */
  id?: string;
  title: string;
  lead?: string | null;
  slug: string;
};

/**
 * Тело уведомления.
 *
 * Лид, а если его нет — заголовок. Пустым тело быть не может: служба приёма в приложении
 * отбрасывает пуш без тела (показывать нечего), и «молния», дошедшая до устройства, но не
 * показанная, ничем не отличается от неотправленной.
 */
export function pushBody(article: PushArticle): string {
  const lead = (article.lead ?? "").replace(/\s+/g, " ").trim();
  const source = lead || article.title.replace(/\s+/g, " ").trim();
  if (source.length <= PUSH_BODY_MAX) return source;

  const cut = source.slice(0, PUSH_BODY_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Адрес материала в приложении и на сайте — тот, куда ведёт тап по уведомлению. */
export function pushArticleUrl(slug: string): string {
  return `${siteUrl().replace(/\/+$/, "")}/news/${slug}`;
}

/**
 * Тело запроса на один токен.
 *
 * Все значения `data` — строки: документация описывает это поле как `map[string]string`, и число
 * или `null` в нём отклонили бы весь запрос как `INVALID_ARGUMENT`.
 */
export function buildPushMessage(
  article: PushArticle,
  token: string,
): { message: { token: string; data: Record<string, string> } } {
  return {
    message: {
      token,
      data: {
        title: article.title.trim(),
        body: pushBody(article),
        url: pushArticleUrl(article.slug),
        slug: article.slug,
      },
    },
  };
}

/** Длина тела запроса в байтах — предел документации считает байты, а не символы. */
export function pushMessageBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/** Что означает ответ на один токен. */
export type PushOutcome = "sent" | "dead" | "failed";

/**
 * Разбор ответа RuStore для одного токена.
 *
 * Чистая функция, и это существенно: единственная ошибка, которая стирает токен из базы,
 * проверяется без сети и без базы.
 */
export function classifyPushOutcome(status: number, payload: unknown): PushOutcome {
  if (status >= 200 && status < 300) return "sent";

  const error = (payload as { error?: { status?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.status === "string" ? error.status.toUpperCase() : "";
  const message = typeof error?.message === "string" ? error.message : "";

  // Платформа назвала виновником сам токен — это документированный пример невалидного токена.
  if (code === "INVALID_ARGUMENT" && /registration token|push.?token/i.test(message)) {
    return "dead";
  }

  // Токена нет на стороне платформы. Доказательство «мы стучимся по верному адресу» проверяет
  // вызывающий: сам по себе 404 бывает и от неверного ID проекта, и тогда удалять нельзя.
  if (status === 404 || code === "NOT_FOUND" || code === "UNREGISTERED") return "dead";

  return "failed";
}

export type PushRunResult = {
  /** True, когда отправлено хотя бы одно уведомление. */
  ok: boolean;
  /** Всего токенов в выборке. */
  total: number;
  sent: number;
  /** Сколько мёртвых токенов удалено. */
  removed: number;
  failed: number;
  /** Строка для редактора: уходит в заметку рядом с Telegram и MAX. */
  summary: string;
  /** Заполняется, когда рассылка не состоялась вовсе. */
  error?: string;
};

/** Зависимости, заменяемые в проверках: база, сеть, время. */
export type PushDeps = {
  listTokens: () => Promise<string[]>;
  removeTokens: (tokens: string[]) => Promise<number>;
  fetchImpl: typeof fetch;
  config: RustorePushConfig;
  log: (line: string) => void;
  warn: (line: string) => void;
};

/**
 * Доступ к базе — ленивым импортом.
 *
 * `@/lib/prisma` падает уже на загрузке, если нет `DATABASE_URL`, и верхний импорт сделал бы
 * этот модуль неимпортируемым из проверок, которым база не нужна вовсе: разбор ответа платформы
 * и сборка запроса — чистые функции, и проверяться они должны без окружения. Тот же приём, что у
 * `@/lib/settings` в издателях Telegram и MAX.
 */
async function pushTokens(): Promise<{ list: () => Promise<string[]>; remove: (tokens: string[]) => Promise<number> }> {
  const { prisma } = await import("@/lib/prisma");
  return {
    list: async () => {
      const rows = await prisma.pushToken.findMany({
        // Старые — первыми: при потолке на прогон очередь не застревает на одних и тех же.
        orderBy: { createdAt: "asc" },
        take: PUSH_MAX_TOKENS,
        select: { token: true },
      });
      return rows.map((row) => row.token);
    },
    remove: async (tokens: string[]) => {
      const result = await prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
      return result.count;
    },
  };
}

function defaultDeps(config: RustorePushConfig = rustorePushConfig()): PushDeps {
  return {
    listTokens: async () => (await pushTokens()).list(),
    removeTokens: async (tokens) => (await pushTokens()).remove(tokens),
    fetchImpl: fetch,
    config,
    log: (line) => console.log(PUSH_LOG_PREFIX, line),
    warn: (line) => console.warn(PUSH_LOG_PREFIX, line),
  };
}

/** Один запрос. Бросает `SyndicationHttpError`, чтобы `withRetry` увидел статус. */
async function postOne(
  deps: PushDeps,
  token: string,
  payload: unknown,
): Promise<{ outcome: PushOutcome; status: number }> {
  const url = `${RUSTORE_PUSH_API_ROOT}/${deps.config.projectId}/messages:send`;

  try {
    const response = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deps.config.serviceToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Ответ не JSON — это прокси или шлюз, а не RuStore. Повторять имеет смысл, и `withRetry`
      // решит это по статусу.
      if (isRetryableStatus(response.status)) {
        throw new SyndicationHttpError(`RuStore: ответ не JSON (HTTP ${response.status})`, response.status);
      }
      deps.warn(`ответ не JSON на HTTP ${response.status}: ${raw.slice(0, 200)}`);
      return { outcome: "failed", status: response.status };
    }

    const outcome = classifyPushOutcome(response.status, parsed);
    if (outcome !== "sent" && isRetryableStatus(response.status)) {
      throw new SyndicationHttpError(`RuStore отклонил отправку (HTTP ${response.status})`, response.status);
    }

    return { outcome, status: response.status };
  } catch (error) {
    if (error instanceof SyndicationHttpError) throw error;
    // Сеть: `withRetry` разберётся по признакам таймаута и сброса соединения.
    throw error;
  }
}

/**
 * Отправляет пуш о материале всем зарегистрированным устройствам.
 *
 * Никогда не бросает. Возвращает сводку: сколько ушло, сколько мёртвых токенов удалено, сколько
 * отказов, и строку для редактора.
 */
export async function sendArticlePush(
  article: PushArticle,
  overrides: Partial<PushDeps> = {},
): Promise<PushRunResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const problem = pushConfigProblem(deps.config);
  if (problem) return { ok: false, total: 0, sent: 0, removed: 0, failed: 0, summary: problem, error: problem };

  const payload = buildPushMessage(article, "…");
  // Проверка объёма считается на подставленном токене: сам токен длиной в пару сотен байт
  // предела не меняет, а увидеть превышение нужно до первой отправки, а не в её ответе.
  const oversized = pushMessageBytes(payload) > PUSH_MESSAGE_BYTE_LIMIT;

  let tokens: string[];
  try {
    tokens = await deps.listTokens();
  } catch (error) {
    const message = `не удалось прочитать токены: ${error instanceof Error ? error.message : "неизвестная ошибка"}`;
    deps.warn(message);
    return { ok: false, total: 0, sent: 0, removed: 0, failed: 0, summary: message, error: message };
  }

  if (tokens.length === 0) {
    return {
      ok: false,
      total: 0,
      sent: 0,
      removed: 0,
      failed: 0,
      summary: "Пуш не отправлен: ни одно устройство ещё не зарегистрировано в приложении.",
      error: "нет подписчиков",
    };
  }

  deps.log(
    `рассылка «${article.slug}»: устройств ${tokens.length}, потолок сообщения ${
      oversized ? "ПРЕВЫШЕН" : "в порядке"
    }`,
  );

  const sentTokens: string[] = [];
  const deadTokens: string[] = [];
  let failed = 0;
  let lastFailure = "";

  for (let start = 0; start < tokens.length; start += PUSH_CONCURRENCY) {
    const wave = tokens.slice(start, start + PUSH_CONCURRENCY);

    const results = await Promise.all(
      wave.map(async (token) => {
        try {
          const message = buildPushMessage(article, token);
          const { outcome, status } = await withRetry(() => postOne(deps, token, message), {
            attempts: PUSH_ATTEMPTS,
            onRetry: ({ attempt, attempts, delayMs }) => {
              deps.warn(`повтор отправки (попытка ${attempt}/${attempts}) через ${delayMs} мс`);
            },
          });
          return { token, outcome, status };
        } catch (error) {
          return {
            token,
            outcome: "failed" as PushOutcome,
            status: 0,
            reason: error instanceof Error ? error.message : "неизвестная ошибка",
          };
        }
      }),
    );

    for (const result of results) {
      if (result.outcome === "sent") sentTokens.push(result.token);
      else if (result.outcome === "dead") deadTokens.push(result.token);
      else {
        failed += 1;
        lastFailure = "reason" in result && result.reason ? result.reason : `HTTP ${result.status}`;
      }
    }
  }

  /*
    Токены удаляются только при доказательстве, что адрес и ключ верны, — то есть когда хоть одно
    уведомление ушло. Иначе неверный ID проекта стёр бы всю базу подписчиков одним прогоном:
    каждый ответ был бы `404`, и каждый токен выглядел бы мёртвым.
  */
  const endpointProven = sentTokens.length > 0;
  const deadToRemove = endpointProven ? deadTokens : [];
  let removed = 0;

  if (deadToRemove.length > 0) {
    try {
      removed = await deps.removeTokens(deadToRemove);
      deps.log(`удалено недействительных токенов: ${removed}`);
    } catch (error) {
      deps.warn(
        `не удалось удалить недействительные токены: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`,
      );
    }
  }

  const warnings: string[] = [];
  if (!endpointProven && deadTokens.length > 0) {
    warnings.push(
      `ни один пуш не ушёл, а ${deadTokens.length} токен(ов) платформа не признала — проверьте RUSTORE_PUSH_PROJECT_ID и RUSTORE_SERVICE_TOKEN; токены оставлены`,
    );
  }
  if (failed > 0 && lastFailure) warnings.push(`отказов ${failed}: ${lastFailure}`);

  const summaryParts = [`ушло ${sentTokens.length} из ${tokens.length}`];
  if (removed > 0) summaryParts.push(`недействительных удалено ${removed}`);
  if (warnings.length > 0) summaryParts.push(warnings.join("; "));

  const summary = `Пуш читателям приложения: ${summaryParts.join(", ")}.`;
  deps.log(summary);

  return {
    ok: sentTokens.length > 0,
    total: tokens.length,
    sent: sentTokens.length,
    removed,
    failed,
    summary,
    ...(sentTokens.length === 0 ? { error: warnings[0] ?? "ни одно уведомление не доставлено" } : {}),
  };
}
