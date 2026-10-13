/**
 * Повтор сетевого вызова с растущей паузой — один для всех каналов синдикации.
 *
 * Зачем отдельный модуль, а не по копии в каждом publisher'е. Замер по коду 13 октября: VK
 * повторял загрузку обложки пять раз с линейной паузой, MAX — один раз и только на
 * `attachment.not.ready`, Telegram — не повторял вообще. Три канала, три разных ответа на один
 * и тот же вопрос «сеть отвалилась, что делать». Четвёртый канал написал бы четвёртый ответ;
 * чтобы этого не случилось, правило живёт здесь.
 *
 * Модуль чистый: без `server-only`, без Prisma, без `fetch`. Он не знает, что такое Telegram
 * или MAX, — он умеет только повторить функцию. Поэтому его проверяет набор проверок без
 * единого сетевого вызова.
 */

/**
 * Стоит ли повторить вызов.
 *
 * Классификация — по коду ошибки, а не по её тексту, и это измеренное решение. На проде
 * встречаются три разных вида отказа, и повторы нужны только двум из них:
 *
 *   429 — платформа просит подождать; это ровно то, для чего нужна растущая пауза;
 *   5xx — платформа сломалась; повтор имеет смысл, обычно проходит;
 *   4xx (кроме 429) — запрос неверен, и следующий такой же неверен тоже; повтор только
 *                    тратит время редактора, который ждёт публикацию.
 *
 * Сетевая ошибка без кода (обрыв, таймаут) считается повторяемой: у неё нет кода именно
 * потому, что ответ не пришёл.
 */
export function isRetryableSyndicationError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === undefined) return true;
  return code === 429 || code >= 500;
}

/**
 * Числовой код ответа платформы, если он есть.
 *
 * Три publisher'а кладут код в разные места — Telegram в `error_code`, VK в
 * `error.error_code`, MAX в поле `code` собственного формата, — поэтому код ищется по всем
 * известным именам, а не по одному. Иначе правило повтора молча зависело бы от того, какой
 * канал его вызвал.
 */
function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const bag = error as Record<string, unknown>;

  const candidates = [
    bag.error_code,
    bag.status,
    bag.statusCode,
    (bag.error as Record<string, unknown> | undefined)?.error_code,
    (bag.response as Record<string, unknown> | undefined)?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

/**
 * HTTP-статус, по которому видно, что отказ временный.
 *
 * Отдельная функция, потому что `fetch` не бросает исключение на 5xx: он возвращает ответ, и
 * решение «повторять» приходится принимать вызывающему. Один вызов — одна точка, где это
 * решено для всех каналов, вместо трёх `if (status >= 500)` по коду.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Ошибка с кодом ответа, чтобы `isRetryableSyndicationError` увидел статус. */
export class SyndicationHttpError extends Error {
  constructor(
    message: string,
    /** Код ответа платформы. */
    readonly error_code: number,
  ) {
    super(message);
    this.name = "SyndicationHttpError";
  }
}

export type RetryOptions = {
  /** Сколько всего попыток, включая первую. */
  attempts?: number;
  /** Пауза перед второй попыткой; дальше растёт вдвое. */
  baseDelayMs?: number;
  /** Верхняя граница паузы, чтобы длинная серия отказов не растянула публикацию на минуты. */
  maxDelayMs?: number;
  /** Решение «повторять ли»; по умолчанию — `isRetryableSyndicationError`. */
  shouldRetry?: (error: unknown) => boolean;
  /** Своя функция ожидания: нужна проверкам, чтобы не спать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
  /** Строка в лог перед каждой паузой. Возвращает текст — модуль остаётся чистым. */
  onRetry?: (info: { attempt: number; attempts: number; delayMs: number; error: unknown }) => void;
};

/** Пауза по умолчанию: линейно-растущая от 500 мс, но не дольше трёх секунд за раз. */
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 3_000;

/**
 * Повторяет `run`, пока он не преуспеет, не исчерпает попытки или не откажет безвозвратно.
 *
 * Пауза растёт вдвое — 500, 1000, 2000 — потому что отказ платформы с растущей нагрузкой не
 * проходит от того, что мы постучимся скорее. К паузе добавляется случайная добавка до 200 мс:
 * несколько публикаций, начатых одной волной, расходятся во времени и не бьют в лимит
 * одновременно.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableSyndicationError;
  const sleep = options.sleep ?? sleepFn;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;

      // Последняя попытка уже была — пауза перед ней ничего не улучшит, а время потратит.
      if (attempt === attempts) break;
      // Отказ, который повторится тем же ответом: сообщаем сразу, не притворяясь, что
      // следующая попытка что-то изменит.
      if (!shouldRetry(error)) throw error;

      const grown = baseDelayMs * 2 ** (attempt - 1);
      const delayMs = Math.min(maxDelayMs, grown) + Math.floor(Math.random() * 200);

      options.onRetry?.({ attempt, attempts, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Не держим процесс живым из-за паузы: при выключении pm2 ожидание не должно мешать.
    timer.unref?.();
  });

/**
 * Пауза, заменяемая для проверок.
 *
 * Приём уже есть в `vk-publisher.ts` (`setVkRetrySleep`) и по той же причине: выдержка — это
 * политика, а не поведение. Набор проверок, который хочет доказать, что три 5xx подряд дают три
 * попытки, не должен для этого спать полторы секунды — иначе он перестанет запускаться на
 * каждый коммит, а это ровно то, что случилось бы с проверкой на реальных паузах.
 */
let sleepFn: (ms: number) => Promise<void> = defaultSleep;

/** Test-only: подменяет паузу между попытками. */
export function setSyndicationSleep(
  sleep: (ms: number) => Promise<void> = defaultSleep,
): void {
  sleepFn = sleep;
}

/** Test-only: возвращает настоящую паузу. */
export function resetSyndicationSleep(): void {
  sleepFn = defaultSleep;
}
