/**
 * The front page and its parts: the live feed, the story cards, the forum block and
 * the news archive the feed points at.
 *
 * The feed's ordering and day headings came from a report that was wrong about its
 * cause, and both halves of that are asserted here so the report cannot repeat.
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
 * fix, and both halves are asserted below — that the order is right, and that the bare
 * times on their own really do look wrong.
 *
 * The rest covers what the polish pass touched: the hero's cover ratio and ceiling,
 * the two thumbnail sizes, the forum block that now appears in two places under two
 * ids, and the archive page the feed's "Вся лента новостей" link depends on existing
 * at all.
 */
import { existsSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArticleCard } from "../src/components/article-card";
import { ForumTopicsBlock } from "../src/components/forum-topics";
import { NewsTicker } from "../src/components/news-ticker";
import { dayLabel, formatTime, groupByDay } from "../src/lib/date";
import type { ActiveForumTopic } from "../src/lib/forum";
import { newsPageHref, parsePageSegment } from "../src/lib/pagination";

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
  check(
    "Лента: внизу ссылка на архив /news",
    html.includes('href="/news"') && html.includes("Вся лента новостей"),
    "ссылка «Вся лента новостей →» на месте",
  );
  check(
    "Лента: архив ведёт на существующий маршрут, а не на 404",
    // `/news/[slug]` is a story route, so a bare `/news` only works because the
    // archive page was added. Asserted here rather than by fetching, because this
    // suite runs without a server.
    /href="\/news"[^>]*>/.test(html) && !/href="\/news\/page\/1"/.test(html),
    "канонический адрес архива — /news",
  );
}

function checkCompactPreview() {
  const article = {
    id: "c1",
    title: "Проверка превью",
    slug: "proverka-prevyu",
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    lead: null,
    coverImage: "/uploads/cover.jpg",
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: null,
  };

  const render = (preview: "sm" | "lg") =>
    renderToStaticMarkup(
      createElement(ArticleCard as never, { article, variant: "compact", preview }),
    );

  const sm = render("sm");
  const lg = render("lg");

  check(
    "Превью: узкий слот остался квадратным 80px",
    sm.includes("aspect-square") && sm.includes("w-20") && sm.includes("rounded-sm"),
    "w-20 + aspect-square на месте",
  );
  check(
    "Превью: широкий слот стал крупнее и скруглённее",
    lg.includes("h-18") &&
      lg.includes("w-24") &&
      lg.includes("sm:h-20") &&
      lg.includes("sm:w-28") &&
      lg.includes("rounded-md"),
    "96×72 → 112×80, rounded-md",
  );
  check(
    "Превью: обрезка по кадру включена в обоих размерах",
    (sm.match(/object-cover/g) ?? []).length === 1 &&
      (lg.match(/object-cover/g) ?? []).length === 1,
    "object-cover по одному разу в каждом",
  );
  check(
    "Превью: размер для браузера совпадает с коробкой",
    sm.includes('sizes="80px"') && lg.includes('sizes="112px"'),
    "80px и 112px",
  );
  check(
    "Превью: заголовок реагирует на наведение на всю карточку",
    sm.includes("group-hover:text-accent"),
    "group-hover на заголовке",
  );
  check(
    "Превью: увеличенный размер не утёк в ленту «Читайте сейчас»",
    !render("sm").includes("sm:w-28"),
    "у «Читайте сейчас» остался sm по умолчанию",
  );
}

function checkLeadCover() {
  const article = {
    id: "h1",
    title: "Главный материал",
    slug: "glavnyy-material",
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    lead: null,
    coverImage: "/uploads/hero.jpg",
    isDzen: true,
    isVk: true,
    isExclusive: true,
    is18plus: false,
    category: null,
  };

  const html = renderToStaticMarkup(
    createElement(ArticleCard as never, { article, variant: "lead" }),
  );

  check(
    "Обложка: соотношение 16:9 и потолок 400px",
    html.includes("aspect-video") && html.includes("max-h-[400px]"),
    "aspect-video + max-h-[400px]",
  );
  check(
    "Обложка: фото обрезается по кадру, а не растягивается",
    html.includes("object-cover"),
    "object-cover на месте",
  );
  check(
    "Обложка: старый arbitrary-ratio убран",
    !html.includes("aspect-[16/9]"),
    "aspect-[16/9] больше не используется",
  );
}

function checkForumBlock() {
  const topics: ActiveForumTopic[] = [
    {
      id: 7,
      title: "Когда в центре починят переход?",
      slug: "kogda-v-centre",
      replies: 12,
      updatedAt: new Date("2026-10-07T09:00:00+03:00"),
      categorySlug: "gorod-i-zhkh",
    },
    {
      id: 8,
      title: "Новые правила для самокатов",
      slug: "novye-pravila-samokotov",
      replies: 3,
      updatedAt: new Date("2026-10-06T18:30:00+03:00"),
      categorySlug: "avto-i-dorogi",
    },
    {
      id: 9,
      title: "Сколько стоит ремонт дороги на Космонавтов",
      slug: "skolko-stoit-remont",
      replies: 0,
      updatedAt: new Date("2026-10-05T11:00:00+03:00"),
      categorySlug: "avto-i-dorogi",
    },
  ];

  const html = renderToStaticMarkup(
    createElement(ForumTopicsBlock as never, {
      topics,
      heading: "Обсуждают на форуме",
      headingId: "home-forum",
      accented: true,
    }),
  );

  check(
    "Форум: заголовок блока на месте",
    html.includes("Обсуждают на форуме") && html.includes('id="home-forum"'),
    "заголовок и aria-labelledby",
  );
  check(
    "Форум: ссылки ведут на темы",
    html.includes('href="/forum/gorod-i-zhkh/kogda-v-centre"') &&
      html.includes('href="/forum/avto-i-dorogi/skolko-stoit-remont"'),
    "обе категории в URL",
  );
  check(
    "Форум: количество ответов выводится бейджем",
    (html.match(/tabular-nums/g) ?? []).length >= 3,
    "по бейджу на тему",
  );
  check(
    "Форум: ноль ответов не прячется",
    html.includes(">0<"),
    "тема без ответов видна",
  );
  check(
    "Форум: есть ссылка на все темы",
    html.includes('href="/forum"'),
    "ссылка на /forum",
  );

  const empty = renderToStaticMarkup(
    createElement(ForumTopicsBlock as never, {
      topics: [],
      heading: "Обсуждают на форуме",
      headingId: "home-forum",
      accented: true,
    }),
  );
  check(
    "Форум: без тем блок не рисуется вовсе",
    empty === "",
    "пустой блок не оставляет заголовка",
  );

  /*
    The sidebar and the homepage both render this block. Two instances with one id
    would be invalid HTML and would silently break `aria-labelledby` for one of them,
    so the ids are asserted to differ rather than just to exist.
  */
  const sidebar = renderToStaticMarkup(
    createElement(ForumTopicsBlock as never, {
      topics,
      heading: "Обсуждения на форуме",
      headingId: "sidebar-forum",
    }),
  );
  check(
    "Форум: id у блоков на разных страницах свои",
    html.includes('id="home-forum"') &&
      sidebar.includes('id="sidebar-forum"') &&
      !html.includes('id="sidebar-forum"'),
    "home-forum и sidebar-forum не совпадают",
  );
  check(
    "Форум: в сайдбаре тонкая линейка, как у соседей",
    sidebar.includes("border-b border-rule") && !sidebar.includes("border-b-2"),
    "стиль сайдбара не изменился",
  );
}

function checkArchive() {
  check(
    "Архив: страница 1 — это /news, а не /news/page/1",
    newsPageHref(1) === "/news" && newsPageHref(2) === "/news/page/2",
    `${newsPageHref(1)}, ${newsPageHref(2)}`,
  );
  check(
    "Архив: сегмент страницы разбирается в число",
    parsePageSegment("3") === 3 &&
      parsePageSegment("1") === 1 &&
      parsePageSegment("мусор") === 1,
    "3, 1 и мусор",
  );
  check(
    "Архив: файлы страниц лежат там, куда ведут ссылки",
    existsSync(new URL("../src/app/(public)/news/page.tsx", import.meta.url)) &&
      existsSync(new URL("../src/app/(public)/news/page/[n]/page.tsx", import.meta.url)),
    "news/page.tsx и news/page/[n]/page.tsx на месте",
  );
}

checkGrouping();
checkMarkup();
checkCompactPreview();
checkLeadCover();
checkForumBlock();
checkArchive();

console.log("Главная: лента новостей, карточки, форум, архив\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;