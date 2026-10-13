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

/** Префикс идентификатора, который выдаёт редактор в браузере. */
export const POLL_OPTION_ID_PREFIX = "opt_";

/** Длина случайной части идентификатора варианта. */
const OPTION_ID_RANDOM_LENGTH = 10;

/**
 * Идентификатор нового варианта.
 *
 * Раньше идентификатор был номером места в списке (`o1`, `o2`), и это ломало опросы при
 * редакции: удаление второго варианта из трёх сдвигало третий на `o2`, и уже поданные за него
 * голоса переезжали к соседу. Измерено на боевой базе 13 октября: два опроса, голоса в обоих
 * хранятся по `o1`/`o2`, то есть перенос голосов при удалении варианта был не гипотезой, а
 * свойством схемы.
 *
 * Идентификатор теперь выдаётся один раз на строку в редакторе и едет вместе с текстом, то
 * есть переживает и удаление соседа, и перестановку, и правку формулировки.
 *
 * Функция не зависит от браузера: её зовёт и редактор (`poll-editor.tsx`), и проверки.
 */
export function newPollOptionId(): string {
  const random = Math.random().toString(36).slice(2, 2 + OPTION_ID_RANDOM_LENGTH);
  return `${POLL_OPTION_ID_PREFIX}${random}${Date.now().toString(36)}`;
}

/** Обрезанный по длине идентификатор — тем же правилом, что и у пришедшего из редактора. */
function cleanPollOptionId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, POLL_OPTION_MAX) : "";
}

/**
 * Готовит то, что ввёл редактор, к хранению, или отвечает null.
 *
 * Возвращает null на всём, что не является опросом: пустой вопрос, один вариант, ни одного
 * заполненного варианта. Так форма сохранения статьи одним решением отвечает и «опроса нет»,
 * и «опрос такой» — без второго прохода по полям в вызывающем коде.
 *
 * `ids` — идентификаторы строк редактора, параллельные `texts`. Пустой или частичный список
 * означает старую вкладку, где идентификаторов ещё не было: тогда варианты нумеруются по месту,
 * как было раньше. Это осознанный запасной путь, а не основной, — он сохраняет поведение для
 * запросов без новых полей.
 */
export function normalisePollInput(
  question: string,
  texts: readonly string[],
  ids: readonly (string | null | undefined)[] = [],
): { question: string; options: PollOption[] } | null {
  const trimmedQuestion = question.trim().slice(0, POLL_QUESTION_MAX);

  const filled = texts
    .map((text, index) => ({ text: text.trim(), id: ids[index] }))
    .filter((row) => row.text.length > 0)
    .slice(0, POLL_MAX_OPTIONS);

  if (!trimmedQuestion || filled.length < POLL_MIN_OPTIONS) return null;

  /*
    Присланный идентификатор берётся, если он не повторяет уже взятый.

    Повтор — это тот же класс поломки, что был с номерами места: два варианта под одним id
    означают, что голоса второго при следующем сохранении переедут к первому. Строка без
    идентификатора (старая вкладка) получает запасной по месту, но не тот, который уже занят.
  */
  const taken = new Set<string>();

  return {
    question: trimmedQuestion,
    options: filled.map((row, index) => {
      const candidate = cleanPollOptionId(row.id);
      const id = candidate.length > 0 && !taken.has(candidate) ? candidate : freeSlotId(index);
      taken.add(id);

      return {
        id,
        text: row.text.slice(0, POLL_OPTION_MAX),
        votes: 0,
      };
    }),
  };

  /** Запасной идентификатор по месту — только если место ещё не занято. */
  function freeSlotId(index: number): string {
    for (let slot = index + 1; slot <= POLL_MAX_OPTIONS + 1; slot++) {
      const candidate = `o${slot}`;
      if (!taken.has(candidate)) return candidate;
    }
    return newPollOptionId();
  }
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
