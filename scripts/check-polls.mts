/**
 * Опросы под материалами и заголовок читательской истории.
 *
 * Набор отдельный, потому что проверяет отдельную вещь: чистые решения — форма вариантов,
 * арифметика процентов, разбор хранилища голосов. Ни базы, ни сети здесь нет, и это не
 * упрощение: всё, что решает, вынесено в `lib/polls.ts` именно ради того, чтобы это можно было
 * проверить без страницы.
 */
import {
  POLL_MAX_OPTIONS,
  pollPercentages,
  pollTotal,
  readPollVotes,
  rememberPollVote,
  parsePollOptions,
  normalisePollInput,
  isPollUsable,
} from "../src/lib/polls";
import { proposalTitle, FORUM_TITLE_MAX_LENGTH } from "../src/lib/forum-text";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

/** Хранилище-заглушка: модуль написан против двух методов, а не против браузера. */
function fakeStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

// --- форма вариантов ----------------------------------------------------------

check(
  "Опрос: варианты читаются из колонки JSON",
  parsePollOptions([{ id: "o1", text: "Да", votes: 3 }]).length === 1 &&
    parsePollOptions([{ id: "o1", text: "Да", votes: 3 }])[0]?.votes === 3,
  JSON.stringify(parsePollOptions([{ id: "o1", text: "Да", votes: 3 }])),
);

check(
  "Опрос: мусор в колонке читается как «опроса нет», а не падает",
  // Колонка держит всё, что туда когда-либо положили, а виджет рисуется на каждой странице
  // материала: испорченная строка обязана давать пустой список, а не исключение.
  parsePollOptions(null).length === 0 &&
    parsePollOptions("строка").length === 0 &&
    parsePollOptions({ options: [] }).length === 0 &&
    parsePollOptions([null, 5, "текст"]).length === 0 &&
    parsePollOptions([{ text: "нет id" }]).length === 0 &&
    parsePollOptions([{ id: "o1", text: "   " }]).length === 0,
  `${parsePollOptions(null).length} записей из null`,
);

check(
  "Опрос: битые счётчики голосов приводятся к нулю",
  parsePollOptions([
    { id: "o1", text: "Да", votes: -5 },
    { id: "o2", text: "Нет", votes: 1.7 },
    { id: "o3", text: "Не знаю", votes: "много" },
  ]).every((option) => Number.isInteger(option.votes) && option.votes >= 0),
  JSON.stringify(parsePollOptions([{ id: "o1", text: "Да", votes: -5 }])),
);

check(
  `Опрос: вариантов не больше ${POLL_MAX_OPTIONS}`,
  parsePollOptions(
    Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, text: `Вариант ${i}`, votes: 0 })),
  ).length === POLL_MAX_OPTIONS,
  `${parsePollOptions(Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, text: "x", votes: 0 }))).length}`,
);

check(
  "Опрос: пригоден, когда есть вопрос и хотя бы два варианта",
  isPollUsable("Вопрос?", [
    { id: "o1", text: "Да", votes: 0 },
    { id: "o2", text: "Нет", votes: 0 },
  ]) &&
    !isPollUsable("", [
      { id: "o1", text: "Да", votes: 0 },
      { id: "o2", text: "Нет", votes: 0 },
    ]) &&
    !isPollUsable("Вопрос?", [{ id: "o1", text: "Да", votes: 0 }]) &&
    !isPollUsable("   ", []),
  "вопрос + минимум два варианта",
);

// --- то, что ввёл редактор ----------------------------------------------------

check(
  "Опрос: пустые варианты не сохраняются и не считаются",
  (() => {
    const poll = normalisePollInput("Вопрос?", ["Да", "  ", "Нет", ""]);
    return poll?.options.length === 2 && poll.options.map((o) => o.text).join(",") === "Да,Нет";
  })(),
  JSON.stringify(normalisePollInput("Вопрос?", ["Да", "  ", "Нет"])?.options.map((o) => o.text)),
);

check(
  "Опрос: без вопроса или без двух вариантов опроса нет",
  normalisePollInput("", ["Да", "Нет"]) === null &&
    normalisePollInput("Вопрос?", ["Да"]) === null &&
    normalisePollInput("Вопрос?", []) === null &&
    normalisePollInput("   ", ["Да", "Нет"]) === null,
  "null, а не половина опроса",
);

check(
  "Опрос: идентификаторы вариантов постоянны между сохранениями",
  // Идентификатор берётся от места в списке, а не случайно: иначе уже поданный голос перестал
  // бы находить свой вариант при каждом сохранении статьи.
  JSON.stringify(normalisePollInput("В", ["Да", "Нет"])?.options.map((o) => o.id)) ===
    JSON.stringify(["o1", "o2"]),
  JSON.stringify(normalisePollInput("В", ["Да", "Нет"])?.options.map((o) => o.id)),
);

// --- проценты -----------------------------------------------------------------

const percentCases: { name: string; options: { id: string; text: string; votes: number }[] }[] = [
  { name: "равные доли", options: [
    { id: "o1", text: "a", votes: 1 },
    { id: "o2", text: "b", votes: 1 },
    { id: "o3", text: "c", votes: 1 },
  ] },
  { name: "трети с остатком", options: [
    { id: "o1", text: "a", votes: 1 },
    { id: "o2", text: "b", votes: 1 },
    { id: "o3", text: "c", votes: 1 },
    { id: "o4", text: "d", votes: 1 },
  ] },
  { name: "один лидер", options: [
    { id: "o1", text: "a", votes: 99 },
    { id: "o2", text: "b", votes: 1 },
  ] },
  { name: "семь против двух", options: [
    { id: "o1", text: "a", votes: 7 },
    { id: "o2", text: "b", votes: 2 },
    { id: "o3", text: "c", votes: 0 },
  ] },
];

check(
  "Опрос: проценты всегда дают ровно 100",
  // Округление по отдельности даёт 99 или 101, и «99%» рядом с полосой во всю ширину читается
  // как ошибка. Остаток отдаётся наибольшей дробной части — правило наибольших остатков.
  percentCases.every(({ options }) => pollPercentages(options).reduce((a, b) => a + b, 0) === 100),
  percentCases
    .map(({ name, options }) => `${name}: ${pollPercentages(options).reduce((a, b) => a + b, 0)}`)
    .join(", "),
);

check(
  "Опрос: без голосов процентов нет, а не деление на ноль",
  pollPercentages([
    { id: "o1", text: "a", votes: 0 },
    { id: "o2", text: "b", votes: 0 },
  ]).every((value) => value === 0) &&
    pollTotal([
      { id: "o1", text: "a", votes: 0 },
      { id: "o2", text: "b", votes: 0 },
    ]) === 0,
  "нули",
);

check(
  "Опрос: сумма голосов считается по вариантам",
  pollTotal([
    { id: "o1", text: "a", votes: 4 },
    { id: "o2", text: "b", votes: 6 },
  ]) === 10,
  "10",
);

// --- голос в браузере ---------------------------------------------------------

check(
  "Голос: битое хранилище читается как «не голосовал»",
  Object.keys(readPollVotes(fakeStorage(null))).length === 0 &&
    Object.keys(readPollVotes(fakeStorage("не json"))).length === 0 &&
    Object.keys(readPollVotes(fakeStorage('["массив"]'))).length === 0 &&
    Object.keys(readPollVotes(fakeStorage('{"p1":5}'))).length === 0,
  JSON.stringify(readPollVotes(fakeStorage('{"p1":5}'))),
);

check(
  "Голос: повторный голос перезаписывает прежний в том же опросе",
  (() => {
    const storage = fakeStorage();
    rememberPollVote(storage, "p1", "o1");
    rememberPollVote(storage, "p2", "o3");
    const after = rememberPollVote(storage, "p1", "o2");
    // Три записи, а не четыре: голос за опрос один, и второй вытесняет первый.
    return after.p1 === "o2" && after.p2 === "o3" && Object.keys(after).length === 2;
  })(),
  JSON.stringify(rememberPollVote(fakeStorage(), "p1", "o1")),
);

// --- заголовок читательской истории ------------------------------------------

check(
  "История: заголовок берётся из первого предложения",
  proposalTitle("Во дворе сломали качели. И ещё что-то.") === "Во дворе сломали качели." &&
    proposalTitle("Одна короткая строка без точки") === "Одна короткая строка без точки",
  proposalTitle("Во дворе сломали качели. И ещё что-то."),
);

check(
  "История: пустой текст всё равно даёт заголовок",
  // Пустую историю действие отклонит раньше, но заголовок не должен оказаться пустым ни при
  // каком вводе: пустая тема на форуме — это тема, которую никто не откроет.
  proposalTitle("") === "История читателя" && proposalTitle("   \n  ") === "История читателя",
  proposalTitle(""),
);

check(
  "История: заголовок обрезается до лимита форума",
  (() => {
    const title = proposalTitle("слово ".repeat(80));
    return title.length <= FORUM_TITLE_MAX_LENGTH && title.length > 0;
  })(),
  `${proposalTitle("слово ".repeat(80)).length} <= ${FORUM_TITLE_MAX_LENGTH}`,
);

check(
  "История: переносы строк внутри истории не ломают заголовок",
  proposalTitle("Первая строка\nвторая строка") === "Первая строка вторая строка",
  proposalTitle("Первая строка\nвторая строка"),
);

console.log("Опросы и истории читателей\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
}
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;
