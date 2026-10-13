/**
 * Повтор сетевого вызова: правило, паузы и классификация отказов.
 *
 * Отдельный набор, потому что проверяет отдельный модуль и без единого сетевого вызова: правило
 * повтора — это политика («повторять ли 429», «не повторять ли 400»), и ошибиться в ней дороже
 * всего, потому что ошибка видна только на проде, в канале, и только когда у площадки плохой
 * день.
 *
 * Пауза подменяется (`setSyndicationSleep`), поэтому набор не спит: проверка «три 5xx дают три
 * попытки» иначе занимала бы полторы секунды и в какой-то момент её перестали бы запускать.
 */
import { stubServerOnly } from "./server-only-shim";

stubServerOnly();

import {
  SyndicationHttpError,
  isRetryableStatus,
  isRetryableSyndicationError,
  resetSyndicationSleep,
  setSyndicationSleep,
  withRetry,
} from "../src/lib/syndication/retry";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

// --- классификация отказов ------------------------------------------------------

check(
  "Повтор: 429 и 5xx считаются временными, 4xx — нет",
  isRetryableSyndicationError(new SyndicationHttpError("лимит", 429)) &&
    isRetryableSyndicationError(new SyndicationHttpError("сервер", 500)) &&
    isRetryableSyndicationError(new SyndicationHttpError("шлюз", 502)) &&
    isRetryableSyndicationError(new SyndicationHttpError("таймаут", 504)) &&
    !isRetryableSyndicationError(new SyndicationHttpError("неверный запрос", 400)) &&
    !isRetryableSyndicationError(new SyndicationHttpError("нет доступа", 403)) &&
    !isRetryableSyndicationError(new SyndicationHttpError("не найдено", 404)),
  "429/5xx повторяются, 400/403/404 — нет",
);

/*
  Сетевая ошибка приходит без кода: ответа не было, а значит и кода нет. Считать её
  безвозвратной значило бы объявлять публикацию провалившейся из-за обрыва, который лечится
  вторым запросом.
*/
check(
  "Повтор: обрыв сети без кода ответа считается временным",
  isRetryableSyndicationError(new Error("fetch failed")) &&
    isRetryableSyndicationError(Object.assign(new Error("timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" })),
  "ошибка без кода ответа повторяется",
);

/*
  Три publisher'а кладут код в разные места, и правило не должно зависеть от того, какой канал
  его вызвал: Telegram использует `error_code`, MAX — `code`, `fetch` — `status`.
*/
check(
  "Повтор: код ответа читается из форматов всех трёх каналов",
  isRetryableSyndicationError({ error_code: 429 }) &&
    isRetryableSyndicationError({ status: 503 }) &&
    isRetryableSyndicationError({ statusCode: 502 }) &&
    isRetryableSyndicationError({ error: { error_code: 500 } }) &&
    !isRetryableSyndicationError({ error_code: 400 }) &&
    !isRetryableSyndicationError({ status: 404 }),
  "error_code / status / statusCode / error.error_code",
);

check(
  "Повтор: решает вызывающий и по HTTP-статусу тоже",
  isRetryableStatus(429) && isRetryableStatus(500) && isRetryableStatus(503) &&
    !isRetryableStatus(400) && !isRetryableStatus(200),
  "то же правило для ответа, который fetch не считает ошибкой",
);

// --- поведение повтора ----------------------------------------------------------

setSyndicationSleep(async () => {});

try {
  // Успех с первой попытки не должен ни спать, ни повторять.
  let firstCalls = 0;
  const first = await withRetry(async () => {
    firstCalls += 1;
    return "готово";
  });
  check(
    "Повтор: удачный вызов не повторяется",
    first === "готово" && firstCalls === 1,
    `${firstCalls} вызов(ов)`,
  );

  // Два 429, потом успех: именно этот случай на проде — площадка просит подождать.
  let flakyCalls = 0;
  const flaky = await withRetry(async () => {
    flakyCalls += 1;
    if (flakyCalls < 3) throw new SyndicationHttpError("слишком часто", 429);
    return "с третьего раза";
  });
  check(
    "Повтор: 429 лечится повтором и в итоге проходит",
    flaky === "с третьего раза" && flakyCalls === 3,
    `${flakyCalls} вызов(ов)`,
  );

  /*
    Главное свойство и главная экономия: 400 не повторяется.
    Повторять неверный запрос — это тратить время редактора, который ждёт публикацию, на
    вопросы, на которые площадка уже ответила.
  */
  let badCalls = 0;
  let badError: unknown = null;
  try {
    await withRetry(async () => {
      badCalls += 1;
      throw new SyndicationHttpError("Bad Request: can't parse entities", 400);
    });
  } catch (error) {
    badError = error;
  }
  check(
    "Повтор: неверный запрос не повторяется ни разу",
    badCalls === 1 && badError instanceof SyndicationHttpError,
    `${badCalls} вызов(ов)`,
  );

  // Серия 5xx: попытки исчерпываются, наружу уходит последняя ошибка, а не первая.
  let downCalls = 0;
  let downError: unknown = null;
  try {
    await withRetry(async () => {
      downCalls += 1;
      throw new SyndicationHttpError(`падение ${downCalls}`, 500);
    });
  } catch (error) {
    downError = error;
  }
  check(
    "Повтор: серия 5xx исчерпывает попытки и сообщает последнюю ошибку",
    downCalls === 3 && (downError as Error)?.message === "падение 3",
    `${downCalls} вызов(ов), ошибка: ${(downError as Error)?.message}`,
  );

  check(
    "Повтор: число попыток задаётся вызывающим",
    await (async () => {
      let calls = 0;
      try {
        await withRetry(
          async () => {
            calls += 1;
            throw new SyndicationHttpError("сервер", 503);
          },
          { attempts: 5 },
        );
      } catch {
        /* ожидаемо */
      }
      return calls === 5;
    })(),
    "attempts: 5 даёт пять попыток",
  );

  // Пауза растёт вдвое — иначе «повтор» был бы просто «постучаться ещё раз поскорее».
  const delays: number[] = [];
  await (async () => {
    try {
      await withRetry(
        async () => {
          throw new SyndicationHttpError("сервер", 500);
        },
        {
          attempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 10_000,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      );
    } catch {
      /* ожидаемо */
    }
  })();

  check(
    "Повтор: пауза растёт вдвое и не превышает потолок",
    delays.length === 3 &&
      delays[0]! >= 100 && delays[0]! < 300 &&
      delays[1]! >= 200 && delays[1]! < 400 &&
      delays[2]! >= 400 && delays[2]! < 600,
    delays.map((d) => `${d} мс`).join(", "),
  );

  check(
    "Повтор: потолок паузы соблюдается при длинной серии",
    await (async () => {
      const waits: number[] = [];
      try {
        await withRetry(
          async () => {
            throw new SyndicationHttpError("сервер", 500);
          },
          {
            attempts: 6,
            baseDelayMs: 1_000,
            maxDelayMs: 3_000,
            sleep: async (ms) => {
              waits.push(ms);
            },
          },
        );
      } catch {
        /* ожидаемо */
      }
      return waits.every((ms) => ms <= 3_000 + 200);
    })(),
    "ни одна пауза не превышает 3 с + разброс",
  );

  // Разброс: несколько публикаций одной волной не должны бить в лимит одновременно.
  const jitter: number[] = [];
  for (let run = 0; run < 12; run += 1) {
    try {
      await withRetry(
        async () => {
          throw new SyndicationHttpError("сервер", 500);
        },
        {
          attempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 10_000,
          sleep: async (ms) => {
            jitter.push(ms);
          },
        },
      );
    } catch {
      /* ожидаемо */
    }
  }
  check(
    "Повтор: пауза различается между вызовами (разброс против одной волны)",
    new Set(jitter).size > 1,
    `${new Set(jitter).size} разных значений из ${jitter.length}`,
  );

  // Своя функция решения: проверяем, что она действительно управляет повтором.
  check(
    "Повтор: своя функция решения уважается",
    await (async () => {
      let calls = 0;
      try {
        await withRetry(
          async () => {
            calls += 1;
            throw new SyndicationHttpError("повторяй", 400);
          },
          { attempts: 4, shouldRetry: () => true },
        );
      } catch {
        /* ожидаемо */
      }
      return calls === 4;
    })(),
    "shouldRetry: true повторяет даже 400",
  );
} finally {
  resetSyndicationSleep();
}

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);
