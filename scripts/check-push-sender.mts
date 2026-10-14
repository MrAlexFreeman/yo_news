/**
 * Проверки рассылки пушей RuStore. Без сети и без базы: `sendArticlePush` принимает зависимости
 * снаружи, а разбор ответа платформы — чистая функция.
 *
 * Запуск: npx tsx scripts/check-push-sender.mts
 *
 * Почему это отдельный набор, а не строки в другом: единственное необратимое действие в проекте
 * — удаление подписчиков из базы. Ошибка разбора ответа стирает токены, которые вернутся только
 * при следующем запуске приложения у читателя, и проверять такие решения на живом сервисе нельзя.
 */

import {
  PUSH_CONCURRENCY,
  PUSH_MESSAGE_BYTE_LIMIT,
  buildPushMessage,
  classifyPushOutcome,
  pushArticleUrl,
  pushBody,
  pushConfigProblem,
  pushMessageBytes,
  rustorePushConfig,
  sendArticlePush,
  type PushDeps,
} from "../src/lib/rustore-push-sender";
import { setSyndicationSleep, resetSyndicationSleep } from "../src/lib/syndication/retry";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

process.env.NEXT_PUBLIC_SITE_URL = "https://eartnews.ru";

const ARTICLE = {
  id: "art1",
  title: "Свердловчане сообщают о проблемах с мобильным интернетом",
  lead: "Жители Екатеринбурга утром пожаловались на перебои с мобильным интернетом.",
  slug: "sverdlovchane-soobschayut-o-problemah",
};

/** Стаб сети: считает попытки по токену и отдаёт заданный ответ. */
function stubPush(behaviour: (token: string, attempt: number) => { status: number; body?: unknown } | "network") {
  const calls: { token: string; url: string; auth: string; body: Record<string, unknown> }[] = [];
  const attempts = new Map<string, number>();

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      message?: { token?: string; data?: Record<string, string> };
    };
    const token = body.message?.token ?? "?";
    const attempt = (attempts.get(token) ?? 0) + 1;
    attempts.set(token, attempt);

    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ token, url, auth: String(headers.Authorization ?? ""), body: body as Record<string, unknown> });

    const answer = behaviour(token, attempt);
    if (answer === "network") throw new TypeError("fetch failed");

    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, attempts };
}

/** Зависимости с подставленной базой, чтобы набор не трогал ни базу, ни окружение. */
function deps(
  overrides: Partial<PushDeps> & { tokens?: string[] } = {},
): { deps: Partial<PushDeps>; removed: string[][] } {
  const removed: string[][] = [];
  const { tokens = ["t1"], ...rest } = overrides;

  return {
    removed,
    deps: {
      config: { projectId: "proj-1", serviceToken: "svc-token" },
      listTokens: async () => tokens,
      removeTokens: async (list: string[]) => {
        removed.push(list);
        return list.length;
      },
      log: () => {},
      warn: () => {},
      ...rest,
    },
  };
}

async function main() {
  // --- настройки ----------------------------------------------------------
  const empty = { projectId: "", serviceToken: "" };
  check(
    "Настройки: без ID проекта и токена рассылка названа ненастроенной",
    pushConfigProblem(empty).includes("RUSTORE_PUSH_PROJECT_ID") &&
      pushConfigProblem({ projectId: "p", serviceToken: "" }).includes("RUSTORE_SERVICE_TOKEN") &&
      pushConfigProblem({ projectId: "p", serviceToken: "s" }) === "",
    pushConfigProblem(empty).slice(0, 60),
  );

  delete process.env.RUSTORE_SERVICE_TOKEN;
  delete process.env.RUSTORE_PUSH_PROJECT_ID;
  check(
    "Настройки: читаются из окружения, а не из базы настроек",
    rustorePushConfig().serviceToken === "" && rustorePushConfig().projectId === "",
    JSON.stringify(rustorePushConfig()),
  );

  // --- текст уведомления --------------------------------------------------
  check(
    "Тело: лид длиннее заголовка и обрезается по слову с многоточием",
    pushBody(ARTICLE).startsWith("Жители Екатеринбурга") &&
      pushBody({ title: "T", slug: "s", lead: "а".repeat(400) }).endsWith("…") &&
      pushBody({ title: "T", slug: "s", lead: "а".repeat(400) }).length <= 161,
    `len=${pushBody({ title: "T", slug: "s", lead: "а".repeat(400) }).length}`,
  );

  /*
    Тело не может быть пустым: служба приёма в приложении отбрасывает пуш без тела, и «молния»,
    дошедшая до устройства, но не показанная, неотличима от неотправленной.
  */
  check(
    "Тело: без лида берётся заголовок, пустым тело не бывает",
    pushBody({ title: "Только заголовок", slug: "s", lead: null }) === "Только заголовок" &&
      pushBody({ title: "Т", slug: "s", lead: "   " }) === "Т",
    JSON.stringify(pushBody({ title: "Т", slug: "s", lead: "   " })),
  );

  check(
    "Ссылка: ведёт на материал сайта",
    pushArticleUrl("moi-slug") === "https://eartnews.ru/news/moi-slug",
    pushArticleUrl("moi-slug"),
  );

  // --- тело запроса -------------------------------------------------------
  const message = buildPushMessage(ARTICLE, "TOKEN-1");
  check(
    "Запрос: один токен, четыре поля data, ни одного объекта notification",
    message.message.token === "TOKEN-1" &&
      Object.keys(message.message.data).sort().join(",") === "body,slug,title,url" &&
      !("notification" in message.message) &&
      Object.values(message.message.data).every((value) => typeof value === "string"),
    JSON.stringify(Object.keys(message.message.data)),
  );
  check(
    "Запрос: укладывается в предел объёма сообщения",
    pushMessageBytes(buildPushMessage(ARTICLE, "T")) < PUSH_MESSAGE_BYTE_LIMIT,
    `${pushMessageBytes(buildPushMessage(ARTICLE, "T"))} < ${PUSH_MESSAGE_BYTE_LIMIT} байт`,
  );

  // --- разбор ответа ------------------------------------------------------
  check(
    "Ответ: 2xx — отправлено",
    classifyPushOutcome(200, {}) === "sent" && classifyPushOutcome(202, null) === "sent",
    "200/202",
  );
  check(
    "Ответ: 404 и UNREGISTERED — токена больше нет",
    classifyPushOutcome(404, { error: { status: "NOT_FOUND" } }) === "dead" &&
      classifyPushOutcome(400, { error: { status: "UNREGISTERED" } }) === "dead",
    "NOT_FOUND / UNREGISTERED",
  );
  check(
    "Ответ: INVALID_ARGUMENT про registration token — токен мёртв",
    classifyPushOutcome(400, {
      error: {
        status: "INVALID_ARGUMENT",
        message: "The registration token is not a valid FCM registration token",
      },
    }) === "dead",
    "документированный пример невалидного токена",
  );

  /*
    Обратная сторона: тот же код и тот же статус, но жалоба не на токен. Значит, дело в запросе —
    в нашем коде или в конфигурации, — и удалять подписчиков за свою ошибку нельзя.
  */
  check(
    "Ответ: INVALID_ARGUMENT про поле payload — это наша ошибка, а не мёртвый токен",
    classifyPushOutcome(400, {
      error: { status: "INVALID_ARGUMENT", message: "Field message.data: invalid value" },
    }) === "failed" &&
      classifyPushOutcome(403, { error: { status: "PERMISSION_DENIED" } }) === "failed" &&
      classifyPushOutcome(500, { error: { status: "INTERNAL" } }) === "failed",
    "поле payload / PERMISSION_DENIED / INTERNAL",
  );

  // --- отправка -----------------------------------------------------------
  {
    const stub = stubPush(() => ({ status: 200 }));
    const baggage = deps({ tokens: ["a", "b", "c"], fetchImpl: stub.fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Рассылка: все токены получили по запросу, сводка честная",
      result.ok &&
        result.sent === 3 &&
        result.failed === 0 &&
        result.removed === 0 &&
        stub.calls.length === 3,
      `${result.sent}/${result.total}, запросов ${stub.calls.length}`,
    );
    check(
      "Рассылка: адрес содержит ID проекта, а ключ идёт заголовком Bearer",
      stub.calls[0]?.url === "https://vkpns.rustore.ru/v1/projects/proj-1/messages:send" &&
        stub.calls[0]?.auth === "Bearer svc-token",
      `${stub.calls[0]?.url} / ${String(stub.calls[0]?.auth).slice(0, 12)}…`,
    );
  }

  {
    const stub = stubPush((token) =>
      token === "dead1" || token === "dead2"
        ? { status: 404, body: { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } } }
        : { status: 200 },
    );
    const baggage = deps({ tokens: ["live", "dead1", "dead2"], fetchImpl: stub.fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Мёртвые токены удаляются, когда есть доказательство верного адреса",
      result.sent === 1 &&
        result.removed === 2 &&
        baggage.removed[0]?.sort().join(",") === "dead1,dead2",
      `ушло ${result.sent}, удалено ${result.removed}: ${baggage.removed[0]?.join(", ")}`,
    );
  }

  /*
    Главная защита этого модуля: неверный ID проекта отвечает `404` на каждый токен, и неотличим
    от «все устройства удалили приложение». Отличие одно — при неверном адресе не уходит ни один
    пуш. Значит, пока ни одно уведомление не доставлено, удалять нельзя: стёртая база
    подписчиков не восстанавливается.
  */
  {
    const stub = stubPush(() => ({
      status: 404,
      body: { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } },
    }));
    const baggage = deps({ tokens: ["a", "b", "c"], fetchImpl: stub.fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Неверный адрес не стирает подписчиков: ни один пуш не ушёл — ни один токен не удалён",
      result.ok === false &&
        result.removed === 0 &&
        baggage.removed.length === 0 &&
        (result.error ?? "").includes("RUSTORE_PUSH_PROJECT_ID"),
      `removed=${result.removed}, error=${(result.error ?? "нет").slice(0, 70)}`,
    );
  }

  {
    const stub = stubPush((token) =>
      token === "bad"
        ? { status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } } }
        : { status: 200 },
    );
    const baggage = deps({ tokens: ["bad", "good"], fetchImpl: stub.fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Невалидный токен удаляется по прямой жалобе платформы",
      result.sent === 1 && result.removed === 1 && baggage.removed[0]?.join(",") === "bad",
      `удалено: ${baggage.removed[0]?.join(", ") ?? "ничего"}`,
    );
  }

  {
    const stub = stubPush((token, attempt) => {
      if (token === "flaky" && attempt === 1) return { status: 500 };
      if (token === "broken") return "network";
      return { status: 200 };
    });
    const baggage = deps({ tokens: ["flaky", "broken", "steady"], fetchImpl: stub.fetchImpl });
    const warns: string[] = [];
    const result = await sendArticlePush(ARTICLE, {
      ...baggage.deps,
      warn: (line) => warns.push(line),
    });

    check(
      "Отказ сети на одном устройстве не мешает остальным",
      result.sent === 2 && result.failed === 1 && result.removed === 0,
      `ушло ${result.sent}, отказов ${result.failed}`,
    );
    check(
      "Повтор после 500 виден в логе",
      warns.some((line) => line.includes("повтор")),
      warns.find((line) => line.includes("повтор")) ?? "нет строки",
    );
  }

  {
    const stub = stubPush(() => ({ status: 200 }));
    const tokens = Array.from({ length: PUSH_CONCURRENCY * 3 + 2 }, (_, index) => `t${index}`);
    const baggage = deps({ tokens, fetchImpl: stub.fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Пачка длиннее одной волны уходит целиком",
      result.sent === tokens.length && stub.calls.length === tokens.length,
      `${result.sent} из ${tokens.length}, волна ${PUSH_CONCURRENCY}`,
    );
  }

  {
    const baggage = deps({ tokens: [], fetchImpl: stubPush(() => ({ status: 200 })).fetchImpl });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Без подписчиков рассылка не считается провалом доставки",
      result.ok === false && result.total === 0 && result.summary.includes("не зарегистрировано"),
      result.summary,
    );
  }

  {
    const baggage = deps({ config: { projectId: "", serviceToken: "" } });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Без настроек ни одного запроса не уходит",
      result.ok === false && result.total === 0 && (result.error ?? "").includes("RUSTORE_PUSH_PROJECT_ID"),
      (result.error ?? "").slice(0, 70),
    );
  }

  {
    const baggage = deps({ listTokens: async () => { throw new Error("база недоступна"); } });
    const result = await sendArticlePush(ARTICLE, baggage.deps);

    check(
      "Падение чтения токенов поймано, а не выброшено",
      result.ok === false && (result.error ?? "").includes("база недоступна"),
      (result.error ?? "").slice(0, 60),
    );
  }
}

setSyndicationSleep(async () => {});
try {
  await main();
} finally {
  resetSyndicationSleep();
}

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);
