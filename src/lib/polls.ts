/**
 * Опрос под материалом: форма вариантов, арифметика процентов и границы, на которых
 * сходятся редакторская форма, парсер и виджет.
 *
 * Здесь нет Prisma и нет `server-only`: это чистые решения о данных, и их проверяет набор
 * проверок — а сохранение и подсчёт голосов живут в действиях, где им и место.
 */

export type PollOption = {
  /** Идентификатор варианта. Выдаётся один раз и не меняется, даже если вариант переставили. */
  id: string;
  text: string;
  votes: number;
};

/** Границы, на которые опирается и форма, и парсер. Меньше двух вариантов — не опрос. */
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 5;
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 120;

/**
 * Варианты из колонки JSON, приведённые к безопасному виду.
 *
 * Колонка держит всё, что туда когда-либо положили: строку, объект, массив без полей. Виджет
 * рисуется на каждой странице материала, поэтому мусор должен превращаться в «опроса нет», а
 * не в падение страницы: пустой массив читается вызывающим кодом как отсутствие опроса.
 */
export function parsePollOptions(value: unknown): PollOption[] {
  if (!Array.isArray(value)) return [];

  const options: PollOption[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { id, text, votes } = raw as { id?: unknown; text?: unknown; votes?: unknown };
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof text !== "string" || text.trim().length === 0) continue;

    options.push({
      id,
      text: text.trim().slice(0, POLL_OPTION_MAX),
      // Голоса — счётчик, а не то, что редактор вводит руками: отрицательное или дробное
      // значение здесь означало бы испорченную строку, и ноль честнее выдуманного числа.
      votes: typeof votes === "number" && Number.isFinite(votes) && votes > 0 ? Math.floor(votes) : 0,
    });

    if (options.length === POLL_MAX_OPTIONS) break;
  }

  return options;
}

/** Пригоден ли опрос к показу: есть вопрос и хотя бы два варианта. */
export function isPollUsable(question: string, options: readonly PollOption[]): boolean {
  return question.trim().length > 0 && options.length >= POLL_MIN_OPTIONS;
}

/**
 * Готовит то, что ввёл редактор, к хранению, или отвечает null.
 *
 * Возвращает null на всём, что не является опросом: пустой вопрос, один вариант, ни одного
 * заполненного варианта. Так форма сохранения статьи одним решением отвечает и «опроса нет»,
 * и «опрос такой» — без второго прохода по полям в вызывающем коде.
 */
export function normalisePollInput(
  question: string,
  texts: readonly string[],
): { question: string; options: PollOption[] } | null {
  const trimmedQuestion = question.trim().slice(0, POLL_QUESTION_MAX);
  const filled = texts.map((text) => text.trim()).filter((text) => text.length > 0);

  if (!trimmedQuestion || filled.length < POLL_MIN_OPTIONS) return null;

  return {
    question: trimmedQuestion,
    options: filled.slice(0, POLL_MAX_OPTIONS).map((text, index) => ({
      // Идентификатор по месту в списке, а не случайный: он должен быть одинаковым при
      // каждом сохранении, иначе уже поданный голос перестанет находить свой вариант.
      id: `o${index + 1}`,
      text: text.slice(0, POLL_OPTION_MAX),
      votes: 0,
    })),
  };
}

/**
 * Проценты по вариантам, суммой ровно 100.
 *
 * Округление по отдельности даёт 99 или 101 — у опроса из трёх вариантов это видно читателю
 * сразу, а «99%» рядом с полосой, дошедшей до конца, читается как ошибка. Остаток отдаётся
 * варианту с наибольшей дробной частью: это обычное правило наибольших остатков, и оно же
 * единственное, которое не зависит от порядка вариантов в массиве.
 *
 * Пока голосов нет, процентов нет: нули, а не деление на ноль.
 */
export function pollPercentages(options: readonly PollOption[]): number[] {
  const total = options.reduce((sum, option) => sum + option.votes, 0);
  if (total <= 0) return options.map(() => 0);

  const exact = options.map((option) => (option.votes / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let leftover = 100 - floors.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floors];
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    leftover -= 1;
  }

  return result;
}

/** Сумма голосов — она же знаменатель и то, что показывается рядом с вопросом. */
export function pollTotal(options: readonly PollOption[]): number {
  return options.reduce((sum, option) => sum + option.votes, 0);
}

/** Ключ, под которым в браузере лежит «за какой опрос и какой вариант я уже голосовал». */
export const POLL_VOTES_STORAGE_KEY = "poll_votes";

/**
 * Часть хранилища, которая нужна этому модулю.
 *
 * Два метода, а не `Storage`: так функции проверяемы без браузера — и так браузерный API не
 * расползается по остальному модулю.
 */
export type PollVoteStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Голоса этого браузера: идентификатор опроса → идентификатор варианта.
 *
 * Защита от накрутки ровно такая, о какой просил редактор, — и она честно слабая: это
 * удобство для читателя, который не должен видеть опрос непроголосованным после перезагрузки,
 * а не барьер против того, кто чистит localStorage. Настоящий барьер потребовал бы
 * идентификации читателя, которой у анонимного новостного сайта нет.
 *
 * Битое значение читается как «не голосовал»: страница не должна падать из-за чужой правки
 * в хранилище.
 */
export function readPollVotes(storage: PollVoteStorage): Record<string, string> {
  try {
    const raw = storage.getItem(POLL_VOTES_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const votes: Record<string, string> = {};
    for (const [pollId, optionId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof optionId === "string" && optionId.length > 0) votes[pollId] = optionId;
    }
    return votes;
  } catch {
    return {};
  }
}

/** Записывает голос и возвращает получившуюся карту. */
export function rememberPollVote(
  storage: PollVoteStorage,
  pollId: string,
  optionId: string,
): Record<string, string> {
  const next = { ...readPollVotes(storage), [pollId]: optionId };
  try {
    storage.setItem(POLL_VOTES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Приватный режим или переполненное хранилище: голос уже принят сервером, и терять
    // из-за этого показ результатов незачем.
  }
  return next;
}
