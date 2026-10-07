/**
 * The homepage feed: ordering and day headings.
 *
 * Two defects met here, and only one of them was a defect.
 *
 * The feed used to carry `lg:sticky lg:top-4`. A sticky element keeps its slot in the
 * flow while painting over whatever scrolls past, so the subscribe card below it slid
 * up across the pinned headlines — the overlap that was reported as the headline
 * problem — and any list taller than the viewport had rows that could never be
 * scrolled into view.
 *
 * The times were reported as scrambled. They were not: the query returns strictly
 * descending order, verified against the database. The feed's badge is a bare clock
 * time, so "11:12" followed by "17:28" looks wrong until you notice the first belongs
 * to one day and the second to the day before. Naming the day between groups is the
 * fix, and both halves are asserted here — that the order is right, and that the bare
 * times on their own really do look wrong.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NewsTicker } from "../src/components/news-ticker";
import { dayLabel, formatTime, groupByDay } from "../src/lib/date";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

type Row = { id: string; at: Date; title: string };

/** Noon Moscow time, so "today" and "yesterday" are unambiguous. */
const NOW = new Date("2026-10-07T12:00:00+03:00");

/**
 * Newest first, spanning four days — the shape a real feed has once it runs past
 * midnight. The clock times read as out of order on purpose, because that is what the
 * reported symptom looked like.
 */
const rows: Row[] = [
  { id: "1", at: new Date("2026-10-07T07:59:00+03:00"), title: "07:59" },
  { id: "2", at: new Date("2026-10-07T07:11:00+03:00"), title: "07:11" },
  { id: "3", at: new Date("2026-10-06T06:35:00+03:00"), title: "06:35" },
  { id: "4", at: new Date("2026-10-05T11:12:00+03:00"), title: "11:12" },
  { id: "5", at: new Date("2026-10-04T17:28:00+03:00"), title: "17:28" },
];

function checkGrouping() {
  const groups = groupByDay(rows, (row) => row.at, NOW);

  check(
    "Лента: одна группа на день",
    groups.length === 4,
    `${groups.length} групп: ${groups.map((g) => g.label).join(" | ")}`,
  );
  check(
    "Лента: первые два дня названы словами",
    groups[0]?.label === "Сегодня" && groups[1]?.label === "Вчера",
    `${groups[0]?.label}, ${groups[1]?.label}`,
  );
  check(
    "Лента: дальше идёт дата, а не слово",
    groups[2]?.label === "5 октября" && groups[3]?.label === "4 октября",
    `${groups[2]?.label}, ${groups[3]?.label}`,
  );
  check(
    "Лента: порядок внутри группы сохранён",
    groups[0]?.items.map((i) => i.id).join(",") === "1,2",
    groups[0]?.items.map((i) => i.id).join(","),
  );
  check(
    "Лента: все материалы попали в группы",
    groups.reduce((sum, group) => sum + group.items.length, 0) === rows.length,
    `${groups.reduce((sum, g) => sum + g.items.length, 0)} из ${rows.length}`,
  );

  const times = rows.map((row) => row.at.getTime());
  check(
    "Лента: порядок строго убывающий — сортировка верна",
    times.every((v, i) => i === 0 || times[i - 1]! >= v),
    `времени подряд: ${rows.map((r) => formatTime(r.at)).join(" ")}`,
  );

  // The reported symptom, reproduced: the bare clock times on their own do run
  // backwards. This is why the day heading is the fix and a re-sort would not be.
  const minutes = rows.map((row) => row.at.getHours() * 60 + row.at.getMinutes());
  const jumps = minutes.filter((m, i) => i > 0 && minutes[i - 1]! < m).length;
  check(
    "Лента: сами часы идут не по порядку — вот что сбивало",
    jumps > 0,
    `часы скачут в ${jumps} местах: ${rows.map((r) => formatTime(r.at)).join(" ")}`,
  );

  // 23:30 Moscow is 20:30 UTC the same day. Both must land in one group, which a
  // naive slice of the ISO string would get wrong across the offset.
  const tzEdges: Row[] = [
    { id: "a", at: new Date("2026-10-07T23:30:00+03:00"), title: "23:30" },
    { id: "b", at: new Date("2026-10-07T20:45:00+03:00"), title: "20:45" },
  ];
  const tzGroups = groupByDay(tzEdges, (row) => row.at, NOW);
  check(
    "Лента: обе записи одного дня в одной группе",
    tzGroups.length === 1 && tzGroups[0]?.label === "Сегодня",
    `${tzGroups.length} групп, «${tzGroups[0]?.label}»`,
  );

  check(
    "Дата: вчерашний день назван верно",
    dayLabel(new Date("2026-10-06T23:59:00+03:00"), NOW) === "Вчера",
    dayLabel(new Date("2026-10-06T23:59:00+03:00"), NOW),
  );

  check(
    "Лента: пустой список не ломает группировку",
    groupByDay<Row>([], (row) => row.at, NOW).length === 0,
    "пусто",
  );
}

function checkMarkup() {
  const articles = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.id,
    publishedAt: row.at,
    createdAt: row.at,
    subtitle: null,
    lead: null,
    coverImage: null,
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: null,
  }));

  const html = renderToStaticMarkup(
    createElement(NewsTicker as never, { articles, now: NOW }),
  );

  check(
    "Лента: в разметке нет sticky — наложения больше не будет",
    !/sticky/.test(html),
    "подстроки sticky нет",
  );
  check(
    "Лента: заголовки дней попали в разметку",
    html.includes("Сегодня") && html.includes("Вчера") && html.includes("5 октября"),
    "подписи на месте",
  );
  check(
    "Лента: материалы не потерялись при группировке",
    (html.match(/<time/g) ?? []).length === rows.length,
    `${(html.match(/<time/g) ?? []).length} отметок времени на ${rows.length} материалов`,
  );
  check(
    "Лента: заголовок раздела остался h2, а материалы — h4",
    /<h2[^>]*>[\s\S]*?Лента новостей/.test(html) && html.includes("<h4"),
    "иерархия заголовков не поехала",
  );
}

checkGrouping();
checkMarkup();

console.log("Главная: лента новостей\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;