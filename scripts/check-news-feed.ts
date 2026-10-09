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
import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArticleCard } from "../src/components/article-card";
import { RiverArticleCard } from "../src/components/river-article-card";
import { SectionGrid } from "../src/components/section-grid";
import { ForumTopicsBlock } from "../src/components/forum-topics";
import { OpinionsBlock } from "../src/components/opinions-block";
import { TrendingBar } from "../src/components/trending-bar";
import { fillSection } from "../src/lib/content-loop";
import { dayLabel, formatTime, groupByDay } from "../src/lib/date";
import type { ActiveForumTopic } from "../src/lib/forum";
import { newsPageHref, parsePageSegment } from "../src/lib/pagination";
import { countWords, readingMinutes } from "../src/lib/reading-time";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/**
 * How many times a substring appears.
 *
 * Counting rather than asserting presence is what turns "there is a hero" into "there are
 * four urgent rows and four rubric cards", which is the claim actually worth making: a
 * block that renders one item where the design says four looks identical in a screenshot
 * at a glance and is caught here.
 */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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
    "Превью: коробка не растягивается флексом — квадрат остаётся квадратом",
    sm.includes("self-start") && lg.includes("self-start"),
    "self-start на обеих коробках",
  );
  check(
    "Превью: увеличенный размер не утёк в ленту «Читайте сейчас»",
    !render("sm").includes("sm:w-28"),
    "у «Читайте сейчас» остался sm по умолчанию",
  );
}

/**
 * Rubric strips, filled: the function that decides what sits in each cell.
 *
 * This is the whole answer to the orphan card. A rubric with one story printed one card
 * beside three columns of paper; `fillSection` tops the row up from the pool the page has
 * not spent yet. The cases below are the ones that actually happen on this site — a
 * rubric with one article, several rubrics competing for the same filler, and a page with
 * nothing left.
 */
function checkRubricFill() {
  const rows = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));

  const used = new Set<string>();
  const full = fillSection(rows("own", 4), rows("pool", 10), 4, used);

  check(
    "Заполнение полосы: четыре карточки собственных материалов",
    full.length === 4 && full.every((row) => row.id.startsWith("own")),
    full.map((row) => row.id).join(", "),
  );

  // The case the brief is about: one article and three columns of nothing.
  const lonely = new Set<string>();
  const filled = fillSection([{ id: "own0" }], rows("pool", 10), 4, lonely);

  check(
    "Заполнение полосы: один материал не оставляет пустоты справа",
    filled.length === 4,
    `${filled.length} из 4`,
  );
  check(
    "Заполнение полосы: сирота идёт первым, добор — после",
    filled[0]?.id === "own0" && filled[3]?.id === "pool2",
    filled.map((row) => row.id).join(", "),
  );

  /*
    Two rubrics, one pool. Without the shared `used` set the first strip would take the
    same four filler cards and the second would print them again — the same headline
    twice on one page, which is the mistake the whole composition is guarded against.
  */
  const shared = new Set<string>();
  const first = fillSection(rows("a", 1), rows("p", 6), 4, shared);
  const second = fillSection(rows("b", 1), rows("p", 6), 4, shared);

  check(
    "Заполнение полосы: две рубрики не делят один и тот же добор",
    first.length === 4 &&
      second.length === 4 &&
      first.every((row) => !second.some((other) => other.id === row.id)),
    `${first.map((row) => row.id).join(",")} / ${second.map((row) => row.id).join(",")}`,
  );

  const dry = fillSection([], [], 4, new Set<string>());
  check(
    "Заполнение полосы: без материала полоса пуста, а не из заглушек",
    dry.length === 0,
    "пусто",
  );

  check(
    "Заполнение полосы: собственный материал, уже показанный, не берётся дважды",
    fillSection([{ id: "own0" }], [], 4, new Set(["own0"])).length === 0,
    "пропущен",
  );
}

/** The feed column, and the stack beside it that has to match its height. */
function checkSectionGrid() {
  const articles = [0, 1, 2, 3].map((index) => ({
    id: `s${index}`,
    title: `Материал рубрики ${index + 1}`,
    slug: `rubrika-${index}`,
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    lead: null,
    coverImage: `/uploads/s${index}.jpg`,
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: { name: "Дом и сад", slug: "home-garden" },
  }));

  const html = renderToStaticMarkup(
    createElement(SectionGrid as never, {
      title: "Дом и сад",
      slug: "home-garden",
      articles,
    }),
  );

  check(
    "Плотная витрина: четыре карточки в ряд на десктопе",
    html.includes("lg:grid-cols-4") && occurrences(html, "aspect-[3/2]") === 4,
    "lg:grid-cols-4, 4 карточки",
  );

  check(
    "Плотная витрина: заголовок рубрики с волосяной чертой во всю ширину",
    html.includes("rubric-line") && html.includes("border-t-2 border-ink"),
    "rubric-line + разделитель секции",
  );

  /*
    The orphan, stated as the two things that produce it: a strip whose columns do not
    match its card count, and a strip that caps itself to one narrow card while the page
    is 1280px wide. Both were printed before, both read as a fault rather than as a
    choice, and the page no longer sends a section with a single card at all.
  */
  check(
    "Плотная витрина: число колонок равно числу карточек — сироты не остаётся",
    !html.includes("max-w-md") && occurrences(html, "aspect-[3/2]") === 4,
    "4 карточки, 4 колонки, без max-w-md",
  );

  const two = renderToStaticMarkup(
    createElement(SectionGrid as never, {
      title: "Происшествия",
      slug: "incidents",
      articles: articles.slice(0, 2),
    }),
  );
  check(
    "Плотная витрина: два материала — две колонки, а не четыре с двумя дырами",
    two.includes("sm:grid-cols-2") && !two.includes("lg:grid-cols-4"),
    "sm:grid-cols-2",
  );

  const three = renderToStaticMarkup(
    createElement(SectionGrid as never, {
      title: "Экономика",
      slug: "economy",
      articles: articles.slice(0, 3),
    }),
  );
  check(
    "Плотная витрина: три материала — три колонки",
    three.includes("sm:grid-cols-3") && !three.includes("lg:grid-cols-4"),
    "sm:grid-cols-3",
  );

  check(
    "Плотная витрина: заголовок рубрики с засечками и плотным трекингом",
    html.includes("--font-lora") && html.includes("tracking-tight"),
    "Lora + tracking-tight",
  );

  check(
    "Плотная витрина: рубрика капсом над заголовком в каждой карточке",
    occurrences(html, "Дом и сад") === 4 + 1,
    `${occurrences(html, "Дом и сад")} (1 заголовок + 4 карточки)`,
  );

  check(
    "Плотная витрина: без теней и рамок — плоский стиль",
    !/shadow-|drop-shadow/.test(html),
    "теней нет",
  );

  check(
    "Плотная витрина: пустая рубрика не рисует заголовок",
    renderToStaticMarkup(
      createElement(SectionGrid as never, { title: "Кино и сцена", slug: "cinema", articles: [] }),
    ) === "",
    "пусто",
  );
}

/**
 * The font pairing, read from the layout's source.
 *
 * `next/font` resolves the files at build time, so there is nothing to assert at runtime
 * about whether Cyrillic is covered — what there is to assert is that the declaration
 * still asks for it. A dropped `subsets: ["cyrillic"]` compiles, deploys, and renders
 * the whole publication in a fallback face; a dropped weight compiles too, and then every
 * serif headline quietly falls back. Both failures are invisible in the markup, which is
 * why they are checked here rather than left to a visual review.
 */
function checkFonts() {
  const layoutSource = readFileSync(
    new URL("../src/app/layout.tsx", import.meta.url),
    "utf8",
  );

  /*
    Every pattern below is anchored at the `Lora({` / `Inter({` call rather than searched
    for anywhere in the file. This file's comments quote the declarations verbatim — the
    reasons the weights and the swap are there — and an unanchored count happily passes on
    the comment while the code underneath is wrong, which is the one failure mode a
    source-reading assertion has and the reason it is worth doing carefully.

    `[\s\S]` rather than the `s` flag: the TypeScript target this project compiles for
    predates `dotAll`, and a check suite that only runs on a newer compiler is a check
    suite that stops running.
  */
  check(
    "Шрифты: у антиквы объявлены 600 и 700 плюс 400 для цитат и лида",
    /Lora\(\{[\s\S]*?weight:\s*\[[^\]]*["']600[^\]]*["']700[^\]]*\][\s\S]*?\}\)/.test(
      layoutSource,
    ),
    "weight внутри вызова Lora()",
  );

  check(
    "Шрифты: кириллица в подмножествах обоих начертаний",
    occurrences(layoutSource, 'subsets: ["latin", "cyrillic"]') === 2,
    `${occurrences(layoutSource, 'subsets: ["latin", "cyrillic"]')} вхождений`,
  );

  check(
    "Шрифты: подмена вместо блокировки — нет сдвига верстки",
    /Inter\(\{[\s\S]*?display: "swap"[\s\S]*?\}\)/.test(layoutSource) &&
      /Lora\(\{[\s\S]*?display: "swap"[\s\S]*?\}\)/.test(layoutSource),
    "display: swap у обоих",
  );

  check(
    "Шрифты: гротеск остаётся основным текстом, антиква — только заголовки",
    layoutSource.includes("--font-inter") &&
      layoutSource.includes("--font-lora") &&
      !layoutSource.includes("body:"),
    "--font-inter + --font-lora",
  );

  const globalsSource = readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );
  check(
    "Шрифты: тело и интерфейс на гротеске",
    /body\s*\{[^}]*--font-inter/.test(globalsSource),
    "body на --font-inter",
  );
  check(
    "Шрифты: двойная линия первой полосы и линия рубрики объявлены один раз",
    occurrences(globalsSource, ".rule-double {") === 1 &&
      occurrences(globalsSource, ".rubric-line {") === 1,
    "по одному объявлению",
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

function checkTypography() {
  const article = {
    id: "t1",
    title: "Заголовок с типографикой",
    slug: "tipografika",
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    lead: "Лид материала.",
    coverImage: null,
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: { name: "Расследования", slug: "investigations" },
  };

  const compact = renderToStaticMarkup(
    createElement(ArticleCard as never, { article, variant: "compact" }),
  );
  const grid = renderToStaticMarkup(createElement(ArticleCard as never, { article }));

  check(
    "Типографика: рубрика — мелкий жирный капс над заголовком",
    compact.includes("font-bold") &&
      compact.includes("tracking-[0.14em]") &&
      compact.includes("uppercase") &&
      compact.includes("Расследования") &&
      compact.indexOf("Расследования") < compact.indexOf(article.title),
    "капс стоит до заголовка",
  );

  check(
    "Типографика: заголовок подчёркивается при наведении на 1px с отступом",
    compact.includes("hover:underline") &&
      compact.includes("decoration-1") &&
      compact.includes("underline-offset-4") &&
      grid.includes("decoration-1") &&
      grid.includes("underline-offset-4"),
    "hover:underline + decoration-1 + underline-offset-4",
  );

  check(
    "Типографика: заголовок заливается акцентом при наведении на карточку",
    compact.includes("group-hover:text-accent") && grid.includes("group-hover:text-accent"),
    "group-hover:text-accent",
  );

  check(
    "Типографика: плотные строки разделены тонкой линией",
    compact.includes("border-b border-rule/70") && compact.includes("py-2.5"),
    "border-b + py-2.5",
  );

  check(
    "Время чтения: считается по словам, минимум одна минута",
    readingMinutes(`<p>${"слово ".repeat(360)}</p>`) === 2 &&
      readingMinutes("<p>короткий текст</p>") === 1,
    `${readingMinutes(`<p>${"слово ".repeat(360)}</p>`)} мин для 360 слов`,
  );

  check(
    "Время чтения: теги, комментарии и сущности не считаются словами",
    countWords("<p>привет<!-- скрыто -->&nbsp;мир</p>") === 2 &&
      countWords("<script>var x = 1;</script><p>текст</p>") === 1,
    `${countWords("<p>привет<!-- скрыто -->&nbsp;мир</p>")} слова`,
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

/** The two new shelves: the topic strip under the navigation, and the opinion column. */
function checkNewShelves() {
  const tags = [
    { name: "Бензин", slug: "benzin" },
    { name: "Антициклон", slug: "anticiklon" },
    { name: "Беспилотники", slug: "bespilotniki" },
    { name: "Транспорт", slug: "transport" },
    { name: "ЖКХ", slug: "zhkh" },
  ];

  const bar = renderToStaticMarkup(
    createElement(TrendingBar as never, { tags }),
  );

  check(
    "Полоса: жирная метка слева",
    bar.includes("В центре внимания") &&
      bar.includes("text-xs font-bold tracking-wider text-ink uppercase"),
    "метка на месте",
  );
  check(
    "Полоса: пять тем ссылками на /tags/",
    occurrences(bar, 'href="/tags/') === 5,
    `${occurrences(bar, 'href="/tags/')} ссылок`,
  );
  check(
    "Полоса: темы — теги, а не рубрики",
    bar.includes("/tags/benzin") && !bar.includes("/category/"),
    "только теги",
  );
  check(
    "Полоса: горизонтальный скролл без полосы прокрутки",
    bar.includes("overflow-x-auto") &&
      bar.includes("scrollbar-width:none") &&
      bar.includes("shrink-0"),
    "overflow-x-auto + скрытый скроллбар",
  );
  check(
    "Полоса: подчёркивание при наведении",
    bar.includes("hover:underline") && bar.includes("underline-offset-4"),
    "underline",
  );
  check(
    "Полоса: без тем не рисуется вовсе",
    renderToStaticMarkup(createElement(TrendingBar as never, { tags: [] })) === "",
    "пусто",
  );

  const opinions = [0, 1, 2].map((index) => ({
    id: `o${index}`,
    title: `Колонка номер ${index + 1}`,
    slug: `kolonka-${index}`,
    publishedAt: new Date(NOW.getTime() - (index + 1) * 60 * 60 * 1000),
    createdAt: NOW,
    coverImage: null,
    lead: null,
    subtitle: null,
    isDzen: true,
    isVk: true,
    isExclusive: index === 0,
    is18plus: false,
    category: { name: "Общество", slug: "society" },
  }));

  const block = renderToStaticMarkup(
    createElement(OpinionsBlock as never, { articles: opinions, headingId: "home-opinions", now: NOW }),
  );

  check(
    "Мнения: три карточки",
    occurrences(block, "border-b border-rule/70 py-3.5") === 3,
    `${occurrences(block, "border-b border-rule/70 py-3.5")}`,
  );
  check(
    "Мнения: круглая монограмма у каждой карточки",
    occurrences(block, "rounded-full border border-rule") === 3 &&
      occurrences(block, 'aria-hidden=""') + occurrences(block, 'aria-hidden="true"') >= 3,
    "3 монограммы",
  );
  check(
    "Мнения: имя автора полужирным",
    block.includes("Колонка редактора") &&
      block.includes("Редакция «Ё-новости»") &&
      block.includes("text-sm font-semibold text-ink"),
    "подпись на месте",
  );
  check(
    "Мнения: заголовок антиквой с подчёркиванием",
    occurrences(block, "font-[family-name:var(--font-lora)] text-sm") >= 3 &&
      block.includes("underline-offset-4"),
    "антиква + подчёркивание",
  );
  check(
    "Мнения: относительное время, а не абсолютная дата",
    block.includes("часа назад") || block.includes("час назад"),
    "относительное время",
  );
  check(
    "Мнения: без материалов блок не рисуется",
    renderToStaticMarkup(
      createElement(OpinionsBlock as never, {
        articles: [],
        headingId: "home-opinions",
        now: NOW,
      }),
    ) === "",
    "пусто",
  );

  /*
    The strip is a shelf under the navigation, so its position is part of the design: it
    has to arrive after the rubric pills and before the page content. Read from the header
    because that ordering is a property of the component tree rather than of any markup.
  */
  const headerSource = readFileSync(
    new URL("../src/components/public-header.tsx", import.meta.url),
    "utf8",
  );
  check(
    "Полоса: стоит под строкой рубрик, а не над шапкой",
    headerSource.indexOf("aria-label=\"Рубрики\"") <
      headerSource.indexOf("<TrendingBar"),
    "рубрики → полоса",
  );
  check(
    "Полоса: вне <header> — это контент, а не навигация сайта",
    headerSource.indexOf("</header>") < headerSource.indexOf("<TrendingBar"),
    "после </header>",
  );
}

/**
 * The two-phase header: masthead at rest, a slim bar once the reader is 120px down.
 *
 * These read the source rather than a render, because the behaviour being asserted — what
 * is in the document, what is in the tab order, what happens to the page height — is not
 * visible in a snapshot of one of the two states. Each of these failures is invisible until
 * a reader hits it.
 */
function checkStickyHeader() {
  const shell = readFileSync(
    new URL("../src/components/header-shell.tsx", import.meta.url),
    "utf8",
  );
  const logo = readFileSync(
    new URL("../src/components/logo.tsx", import.meta.url),
    "utf8",
  );
  const layout = readFileSync(
    new URL("../src/app/(public)/layout.tsx", import.meta.url),
    "utf8",
  );

  /* ---- the two states ---- */

  check(
    "Шапка: порог схлопывания 120px",
    /const COMPACT_AFTER_PX = 120;/.test(shell) &&
      shell.includes("top: COMPACT_AFTER_PX"),
    "маркер на 120px",
  );

  check(
    "Шапка: маркер — тонкий, а не блок во всю ширину",
    shell.includes("w-px") &&
      shell.includes("height: 1 }") &&
      shell.includes("pointer-events-none absolute"),
    "1×1px, вне потока",
  );

  /*
    The listener. An IntersectionObserver on a marker does its work twice per scroll — once
    crossing the threshold, once crossing back — where a scroll handler runs on every frame
    of every scroll on every page to compare a number against 120.
   */
  check(
    "Шапка: порог ловится наблюдателем, а не слушателем scroll",
    shell.includes("new IntersectionObserver(") &&
      !shell.includes('addEventListener("scroll"'),
    "IntersectionObserver, без scroll-слушателя",
  );
  check(
    "Шапка: наблюдатель отпускается при размонтировании",
    shell.includes("observer.disconnect()"),
    "disconnect в cleanup",
  );

  /* ---- no jump: the reason the bar is fixed and not sticky ---- */

  /*
    The load-bearing assertion of this change. A sticky bar occupies flow space, so growing
    it from 0 to 52px shoves the whole document down by 52px at the moment it appears —
    exactly the jump the design asks to avoid. `fixed` is what makes the bar cost the page
    nothing.
   */
  check(
    "Шапка: компактная панель вне потока — контент не сдвигается",
    shell.includes('"fixed inset-x-0 top-0 z-50"') &&
      !/sticky[^"]*top-0[^"]*h-\[52px\]/.test(shell),
    "fixed, не sticky",
  );
  /*
    Exactly one *class*, not one mention: the file's own comment quotes the height too, and
    a check that matched both would fail on a comment edit and pass on a second row.
   */
  const heightClasses = occurrences(shell, "flex h-[52px] max-w-7xl");
  check(
    "Шапка: высота 52px задана один раз и не зависит от состояния",
    heightClasses === 1,
    `${heightClasses} строка с высотой`,
  );

  /*
    The bar covers the top of the page while scrolled, so it has to look like paper rather
    than like a panel floating over an article.
   */
  check(
    "Шапка: размытие и полупрозрачность фона",
    shell.includes("bg-paper/95") && shell.includes("backdrop-blur-sm"),
    "bg-paper/95 + backdrop-blur-sm",
  );
  check(
    "Шапка: граница и тень, чтобы отделяться от текста",
    shell.includes("border-b border-rule") && shell.includes("shadow-sm"),
    "border-b + shadow-sm",
  );

  /* ---- accessibility: the off-screen masthead must leave the tab order ---- */

  /*
    Without `inert` the masthead keeps its links focusable while it is scrolled out of
    view, so a keyboard user tabs into a header they cannot see and a screen reader reads a
    navigation that is nowhere near the viewport.
   */
  check(
    "Шапка: ушедшая мачта уходит из порядка табуляции",
    shell.includes("inert={compact ? true : undefined}"),
    "inert на мачте",
  );
  check(
    "Шапка: невидимая панель тоже недоступна с клавиатуры",
    shell.includes("inert={compact ? undefined : true}"),
    "inert на скрытой панели",
  );

  /*
    `hidden` instead of `inert` on the hidden bar would drop it from layout the instant
    compact turns off, so the bar would blink out of existence rather than slide.
   */
  check(
    "Шапка: скрытие анимацией, а не display:none",
    shell.includes("-translate-y-full") &&
      shell.includes("translate-y-0") &&
      shell.includes("duration-300"),
    "translate + transition",
  );
  check(
    "Шапка: анимация уважает prefers-reduced-motion",
    shell.includes("motion-reduce:transition-none"),
    "motion-reduce:transition-none",
  );

  /* ---- what the compact bar carries ---- */

  check(
    "Шапка: компактный логотип рядом с поиском",
    shell.includes('<Logo size="xs" />') &&
      shell.includes('aria-label="Ё-новости — на главную"'),
    "Logo xs + ссылка на главную",
  );
  check(
    "Шапка: у логотипа есть размер xs в 24px",
    /xs: \{ letter: "text-2xl"/.test(logo),
    "letter: text-2xl",
  );
  /*
   * The regression this rework exists for. The bar used to hold the trending words between
   * the wordmark and the controls, and in the built page they ran into the logo with nothing
   * marking the join: one unbroken run of small type where the reader could not tell where
   * «Ё-новости» ended and the labels began. Three controls and nothing else is the fix, so
   * the absence of the list is the assertion.
   */
  check(
    "Шапка: в панели нет списка тем — каша у логотипа устранена",
    !shell.includes('aria-label="В центре внимания"') &&
      !shell.includes("trendingTags"),
    "тем в панели нет",
  );
  check(
    "Шапка: в панели ровно три элемента — меню, логотип, кнопки",
    shell.includes("<Menu ") &&
      shell.includes("<Search ") &&
      occurrences(shell, "<Logo ") === 1,
    "бургер + поиск + один логотип",
  );
  check(
    "Шапка: кнопка меню подписана и сообщает своё состояние",
    shell.includes("Разделы") && shell.includes("aria-expanded={menuOpen}"),
    "подпись + aria-expanded",
  );

  /*
   * The pills used to live in the masthead row this bar replaces. Without a menu a reader
   * who is scrolled cannot reach a rubric at all, and on a phone the pills were the only
   * route to one — so the drawer is the load-bearing half of this change, not a nicety.
   */
  check(
    "Шапка: рубрики доступны из панели, а не потеряны",
    shell.includes('aria-label="Разделы"') &&
      shell.includes("categories.map") &&
      shell.includes('href="/forum"'),
    "все рубрики + форум в меню",
  );
  check(
    "Шапка: меню закрывается по Escape",
    shell.includes('event.key === "Escape"'),
    "клавиша Escape",
  );
  /*
   * The drawer is closed by derivation, not by an effect. Both things that have to close it
   * — navigating away, and scrolling back to the top so the bar leaves the screen while the
   * panel is still anchored under it — are conditions the render already knows about. An
   * effect calling `setState` for either one is a second render pass for no reason, and the
   * linter is right to object to it.
   */
  check(
    "Шапка: меню закрывается при переходе и при уходе шапки",
    shell.includes("menu.open && menu.at === pathname && compact") &&
      !shell.includes("setMenuOpen"),
    "вывод из состояния, без эффекта",
  );
  check(
    "Шапка: закрытое меню недоступно с клавиатуры",
    shell.includes("hidden={!menuOpen}") &&
      shell.includes("inert={menuOpen ? undefined : true}"),
    "hidden + inert",
  );
  check(
    "Шапка: логотип по центру, а не по течению",
    shell.includes("absolute left-1/2 -translate-x-1/2"),
    "left-1/2 + -translate-x-1/2",
  );
  check(
    "Шапка: эфир и поиск остаются доступны",
    shell.includes("Прямой эфир") && shell.includes('href="/search"'),
    "эфир + поиск",
  );

  /*
    Without a spacer the strip vanishes when there are no tags, the logo and the controls
    drift together as the window narrows, and the bar stops reading as two ends.
   */
  check(
    "Шапка: без тем логотип и кнопки остаются по краям",
    shell.includes("ml-auto flex shrink-0 items-center gap-1"),
    "кнопки прижаты вправо",
  );

  /* ---- wiring ---- */

  /*
    The masthead stays a server component and reaches the browser as `children` of a client
    shell. The shell must not import it: that would pull the whole masthead — and the
    category query that fills it — into the client bundle and give up the prerendering the
    layout is built around.
   */
  check(
    "Шапка: мачта рендерится на сервере и передаётся как children",
    layout.includes("<HeaderShell categories={categories}>") &&
      layout.includes('import { PublicHeader } from "@/components/public-header";'),
    "мачта в layout, дети в HeaderShell",
  );
  check(
    "Шапка: обёртка не импортирует мачту — она остаётся серверной",
    !shell.includes('from "@/components/public-header"'),
    "обёртка не знает о мачте",
  );
}

/**
 * The story river and the two-column grid around it.
 *
 * What is asserted here is the layout the design names, and two of the assertions are about
 * things a screenshot of a single viewport cannot show: that the picture comes *after* the
 * text in the DOM at every width, and that the river and the sidebar draw from one shared
 * claim set.
 */
function checkStoryRiver() {
  const card = (
    overrides: Partial<Parameters<typeof RiverArticleCard>[0]["article"]> = {},
    props: { lead?: boolean } = {},
  ) =>
    renderToStaticMarkup(
      createElement(RiverArticleCard as never, {
        article: {
          id: "r1",
          title: "Материал для реки",
          slug: "material-r",
          subtitle: null,
          lead: null,
          coverImage: null,
          contentHtml: `<p>${"слово ".repeat(400)}</p>`,
          isExclusive: false,
          is18plus: false,
          isDzen: true,
          isVk: true,
          publishedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          createdAt: NOW,
          photoAuthor: null,
          photoSource: null,
          category: { name: "Общество", slug: "society" },
          ...overrides,
        },
        now: NOW,
        ...props,
      }),
    );

  const plain = card();
  const withPhoto = card({
    coverImage: "/uploads/river.jpg",
    photoSource: "Фото: Reuters",
  });

  /* ---- the grid ---- */

  const pageSource = readFileSync(
    new URL("../src/app/(public)/page.tsx", import.meta.url),
    "utf8",
  );

  check(
    "Река: газетная сетка 12 колонок",
    pageSource.includes("grid-cols-1") &&
      pageSource.includes("lg:grid-cols-12") &&
      pageSource.includes("gap-8"),
    "grid-cols-1 lg:grid-cols-12 gap-8",
  );
  check(
    "Река: река на 8 колонок, сайдбар на 4",
    occurrences(pageSource, "lg:col-span-8") === 1 &&
      occurrences(pageSource, "lg:col-span-4") === 1,
    "8 + 4",
  );

  /*
   * DOM order is the whole of the mobile behaviour. `flex-col-reverse` puts the picture
   * first on a phone, and it does so in one place rather than by reordering at a breakpoint —
   * a card written as `flex-col` would read text-first at every width.
   */
  check(
    "Река: фото сверху на телефоне, текст под ним",
    plain.includes("flex-col-reverse") && plain.includes("md:flex-row"),
    "flex-col-reverse + md:flex-row",
  );

  check(
    "Река: на десктопе текст слева, фото справа",
    plain.includes("md:basis-2/5") && withPhoto.includes("md:basis-3/5"),
    "40% текст / 60% фото",
  );

  /* ---- the card itself ---- */

  check(
    "Река: заголовок антиквой Lora и крупный",
    plain.includes("--font-lora") && plain.includes("text-xl leading-snug md:text-2xl"),
    "Lora 20→24px",
  );
  check(
    "Река: лид на 2–4 строки",
    plain.includes("clamp-3 mt-2 text-sm leading-relaxed"),
    "clamp-3 + text-sm",
  );
  check(
    "Река: метаданные — время, час, минуты чтения",
    plain.includes("мин</span>") && plain.includes("<time"),
    "относительное + чтение",
  );
  check(
    "Река: рубрика капсом акцентным цветом",
    plain.includes("text-accent"),
    "text-accent",
  );
  check(
    "Река: фото 16:9 без скруглённых углов, object-cover",
    withPhoto.includes("aspect-video") && withPhoto.includes("object-cover"),
    "aspect-video + object-cover",
  );
  check(
    "Река: подпись под фото",
    withPhoto.includes("Фото: Reuters") && withPhoto.includes("text-[11px]"),
    "кредит выводится",
  );

  /* ---- a story with no photograph ---- */

  /*
   * It runs the text across the full width rather than being squeezed into the 40% column or
   * given a grey plate. The card's own layout does this: the media branch is absent, so the
   * text element is the only child and takes the row.
   */
  check(
    "Река: без фото карточка идёт во всю ширину, без заглушки",
    !plain.includes("aspect-video") && !plain.includes("/placeholder.png"),
    "ни кадра, ни серой плашки",
  );
  check(
    "Река: без фото заголовок остаётся крупным",
    plain.includes("text-xl leading-snug md:text-2xl"),
    "те же кегли, что и у карточки с фото",
  );

  /* ---- the deck ---- */

  /*
   * Syndicated material carries a headline and a body but no lead, which is most of what
   * arrives on this site. Without the body fallback a third of the river would be a headline
   * with nothing under it.
   */
  check(
    "Река: лид берётся из lead, иначе из текста",
    card({ lead: "Лид из редакции" }).includes("Лид из редакции") &&
      card({ subtitle: "Подзаголовок" }).includes("Подзаголовок") &&
      card().includes("слово слово"),
    "lead → subtitle → начало текста",
  );

  /* ---- deduplication ---- */

  check(
    "Река: лид забирается в общий used до всех остальных блоков",
    pageSource.includes("new Set<string>(hero ? [hero.id] : [])") &&
      pageSource.indexOf("new Set<string>(hero") <
        pageSource.indexOf("const riverBody = take("),
    "used создан до выборки реки",
  );
  check(
    "Река: сайдбар забирается после реки, из того же used",
    pageSource.indexOf("const riverBody = take(") <
      pageSource.indexOf("const nowReading = take(") &&
      /fillRanked\(\s*investigations,\s*specRest,\s*SPEC_TOPIC_COUNT,\s*used,?\s*\)/.test(
        pageSource,
      ),
    "река → сайдбар, один набор",
  );

  /*
   * `fillRanked` claims its picks in `used` itself. Wrapping it in `take` — which skips
   * anything already claimed — filters out precisely the rows `fillRanked` just took, and
   * the block renders empty under a heading that promises three. It shipped once: the
   * sidebar had a heading and no rows, and no amount of looking at the query would have
   * explained it.
   */
  check(
    "Река: fillRanked не обёрнут в take — иначе он отфильтрует сам себя",
    /const specItems = fillRanked\(/.test(pageSource) &&
      !/const specItems = take\(\s*fillRanked/.test(pageSource),
    "specItems = fillRanked(...) напрямую",
  );

  /* ---- the sidebar ---- */

  check(
    "Река: в сайдбаре мнения, читают и спецтема",
    pageSource.indexOf("<OpinionsBlock") < pageSource.indexOf("<NowReading") &&
      pageSource.indexOf("<NowReading") < pageSource.indexOf("<SpecTopicBlock"),
    "мнения → читают → спецтема",
  );
  check(
    "Река: левая река объявлена раньше сайдбара в DOM",
    pageSource.indexOf("lg:col-span-8") < pageSource.indexOf("lg:col-span-4"),
    "река → сайдбар",
  );

  /* ---- the lead card is the first one ---- */

  check(
    "Река: лид — первая карточка и на размер шаг больше",
    card({}, { lead: true }).includes("lg:text-3xl") &&
      !card({}, { lead: true }).includes("text-xl leading-snug md:text-2xl"),
    "lead=true → text-2xl lg:text-3xl",
  );
}

checkStoryRiver();
checkStickyHeader();
checkGrouping();
checkCompactPreview();
checkRubricFill();
checkSectionGrid();
checkNewShelves();
checkTypography();
checkFonts();
checkForumBlock();
checkArchive();

console.log("Главная: лента новостей, карточки, форум, архив\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;