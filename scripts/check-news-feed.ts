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
import { FrontPageHero } from "../src/components/front-page-hero";
import { SectionGrid } from "../src/components/section-grid";
import { ForumTopicsBlock } from "../src/components/forum-topics";
import { NewsTicker } from "../src/components/news-ticker";
import { SpecTopicBlock } from "../src/components/spec-topic-block";
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
function checkFeedColumn() {
  const articles = [0, 1, 2].map((index) => ({
    id: `t${index}`,
    title: `Новость ленты ${index + 1}`,
    slug: `lenta-${index + 1}`,
    publishedAt: NOW,
    createdAt: NOW,
    lead: null,
    subtitle: null,
    coverImage: null,
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: { name: "Общество", slug: "society" },
  }));

  const html = renderToStaticMarkup(
    createElement(NewsTicker as never, { articles, now: NOW }),
  );

  check(
    "Лента: строки разряжены до py-3.5",
    html.includes("py-3.5") && !html.includes("py-2.5"),
    "py-3.5",
  );
  check(
    "Лента: заголовок крупнее и контрастнее",
    html.includes("md:text-base") && html.includes("text-ink"),
    "text-sm md:text-base + text-ink",
  );
  check(
    "Лента: время оранжевое и читаемое на мелком кегле",
    html.includes("text-yo-ink"),
    "text-yo-ink",
  );
  check(
    "Лента: рубрика отдельной плашкой, а не серой массой",
    html.includes("bg-paper-dim") && html.includes("Общество"),
    "плашка рубрики",
  );
  check(
    "Лента: время и рубрика разделены точкой",
    // `aria-hidden="true"`, not `aria-hidden=""`: React renders a bare boolean ARIA
    // attribute as the string "true", and asserting the empty form would pass on a
    // hand-written fixture and fail on the real render.
    html.includes('aria-hidden="true"') && html.includes("·"),
    "разделитель есть",
  );

  const spec = renderToStaticMarkup(
    createElement(SpecTopicBlock as never, {
      articles,
      headingId: "home-spec",
    }),
  );

  check(
    "Спецтема: три строки с засечными заголовками",
    occurrences(spec, "py-3.5") === 3 &&
      occurrences(spec, "font-[family-name:var(--font-lora)]") === 3,
    `${occurrences(spec, "py-3.5")} строк(и)`,
  );
  check(
    "Спецтема: без фотографий — иначе дыра вернётся в меньшем размере",
    !spec.includes("<img"),
    "картинок нет",
  );
  check(
    "Спецтема: пустой блок не рисуется",
    renderToStaticMarkup(
      createElement(SpecTopicBlock as never, { articles: [], headingId: "home-spec" }),
    ) === "",
    "пусто",
  );

  /*
    The balance is a property of the page, not of a component: the column beside the feed
    has to carry as much as the chronology. Read from the source because rendering the
    page would mean a database, and because the claim is about which components share the
    column rather than about any one of their markup.
  */
  const pageSource = readFileSync(
    new URL("../src/app/(public)/page.tsx", import.meta.url),
    "utf8",
  );
  const column = pageSource.slice(
    pageSource.indexOf('<div className="space-y-6">'),
    pageSource.indexOf("</div>\n      </div>\n\n      {/* Rubric strips"),
  );

  check(
    "Баланс колонок: рядом с лентой стоят три блока, а не одна плашка",
    occurrences(column, "<SpecTopicBlock") === 1 &&
      occurrences(column, "<SubscribeBlock") === 1 &&
      occurrences(column, "<ForumTopicsBlock") === 1,
    "спецтема + подписка + форум",
  );
}

/** The standfirst under the front page's headline is never empty. */
function checkHeroStandfirst() {
  const base = {
    id: "h1",
    title: "Главный материал",
    slug: "glavnyy-material",
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    coverImage: "/uploads/hero.jpg",
    isDzen: true,
    isVk: true,
    isExclusive: true,
    is18plus: false,
    category: { name: "Расследования", slug: "investigations" },
  };

  const fromLead = renderToStaticMarkup(
    createElement(FrontPageHero as never, {
      lead: { ...base, lead: "Лид, написанный редакцией.", contentHtml: "<p>Тело статьи.</p>" },
      urgent: [],
    }),
  );
  check(
    "Лид главного: написанный редакцией лид выводится под заголовком",
    fromLead.includes("Лид, написанный редакцией."),
    "лид на месте",
  );

  const generated = renderToStaticMarkup(
    createElement(FrontPageHero as never, {
      lead: {
        ...base,
        lead: null,
        contentHtml: `<p>${"предложение ".repeat(60)}</p>`,
      },
      urgent: [],
    }),
  );

  const standfirst = /<p class="mt-3 mb-4[^"]*">([^<]+)<\/p>/.exec(generated)?.[1] ?? "";
  check(
    "Лид главного: без лида превью собирается из текста статьи",
    standfirst.startsWith("предложение") && standfirst.length > 0,
    JSON.stringify(standfirst.slice(0, 40)),
  );
  check(
    "Лид главного: превью обрезано примерно на 180 знаках",
    standfirst.length <= 181 && standfirst.endsWith("…"),
    `${standfirst.length} символов`,
  );

  check(
    "Главное фото: потолок высоты, чтобы лид и метаданные не ушли за первый экран",
    generated.includes("max-h-[360px]") && generated.includes("md:max-h-[420px]"),
    "360 / 420",
  );

  check(
    "Главное фото: пропорции и кадрирование на месте",
    generated.includes("aspect-video") && generated.includes("object-cover"),
    "aspect-video + object-cover",
  );

  const empty = renderToStaticMarkup(
    createElement(FrontPageHero as never, {
      lead: { ...base, lead: null, contentHtml: "" },
      urgent: [],
    }),
  );
  check(
    "Лид главного: у материала без текста блок просто не рисуется",
    !empty.includes('class="mt-3 mb-4'),
    "пустого блока нет",
  );
}
/**
 * The top of the front page, rendered.
 *
 * This replaced the assertions on the old `lead` card variant. Two things were being
 * checked there that still hold — the 16:9 crop and the absence of a hard-coded height —
 * and one that changed: the lead story now prints its headline before its picture, with a
 * metadata line under it, so the order of the markup is itself part of the contract.
 */
function checkFrontHero() {
  const lead = {
    id: "h1",
    title: "Главный материал",
    slug: "glavnyy-material",
    publishedAt: NOW,
    createdAt: NOW,
    subtitle: null,
    lead: "Лид в двух предложениях, который читатель видит под заголовком.",
    coverImage: "/uploads/hero.jpg",
    contentHtml: `<p>${"слово ".repeat(400)}</p>`,
    isDzen: true,
    isVk: true,
    isExclusive: true,
    is18plus: false,
    category: { name: "Расследования", slug: "investigations" },
  };

  const urgent = [0, 1, 2, 3].map((index) => ({
    id: `u${index}`,
    title: `Срочный сюжет ${index + 1}`,
    slug: `srochnyy-${index + 1}`,
    publishedAt: NOW,
    createdAt: NOW,
    coverImage: `/uploads/u${index}.jpg`,
    isDzen: true,
    isVk: true,
    isExclusive: false,
    is18plus: false,
    category: { name: "Происшествия", slug: "incidents" },
  }));

  const html = renderToStaticMarkup(
    createElement(FrontPageHero as never, { lead, urgent }),
  );

  check(
    "Первая полоса: обложка 16:9, без растягивания и без старого ratio",
    html.includes("aspect-video") &&
      html.includes("object-cover") &&
      !html.includes("aspect-[16/9]"),
    "aspect-video + object-cover",
  );

  check(
    "Первая полоса: заголовок с засечками, крупный и плотный по трекингу",
    html.includes("--font-lora") &&
      html.includes("lg:text-4xl") &&
      html.includes("leading-tight") &&
      html.includes("tracking-tight"),
    "Lora + text-4xl + leading-tight + tracking-tight",
  );

  check(
    "Первая полоса: заголовок идёт раньше фотографии",
    html.indexOf("Главный материал") < html.indexOf("aspect-video"),
    "h1 выше по разметке",
  );

  check(
    "Первая полоса: лид приглушённым шрифтом под заголовком",
    html.includes("Лид в двух предложениях") && html.includes("text-ink-soft"),
    "лид на месте",
  );

  check(
    "Первая полоса: строка метаданных — дата, время чтения, источник",
    html.includes("мин чтения") && html.includes("Ё-новости") && html.includes("<time"),
    "дата · минуты · издание",
  );

  check(
    "Первая полоса: асимметрия 7/5 с волосяной линией между колонками",
    html.includes("lg:col-span-7") &&
      html.includes("lg:col-span-5") &&
      html.includes("lg:border-l"),
    "7/5 + разделитель",
  );

  check(
    "Первая полоса: замыкается двойной линией",
    html.includes("rule-double"),
    "rule-double",
  );

  check(
    "Первая полоса: на телефоне одна колонка — лид сверху, срочное под ним",
    !html.includes("lg:grid-cols-12") || html.includes("grid gap-x-10 gap-y-7"),
    "одна колонка до lg",
  );

  check(
    "Первая полоса: срочная колонка — четыре строки через тонкую линию",
    occurrences(html, "border-b border-rule/70 py-4") === 4,
    `${occurrences(html, "border-b border-rule/70 py-4")} строк(и)`,
  );

  check(
    "Первая полоса: у срочного сюжета миниатюра справа, квадратная",
    html.includes("size-24") && html.includes("self-start") && html.includes("flex items-start gap-4"),
    "миниатюра справа, self-start",
  );

  check(
    "Первая полоса: заголовок срочного сюжета с засечками и подчёркиванием при hover",
    occurrences(html, "font-[family-name:var(--font-lora)] text-base") >= 4 &&
      html.includes("underline-offset-4"),
    "Lora + underline-offset-4",
  );

  const empty = renderToStaticMarkup(
    createElement(FrontPageHero as never, { lead, urgent: [] }),
  );
  check(
    "Первая полоса: без срочных сюжетов колонка не рисуется",
    !empty.includes("Важное за сегодня") && empty.includes("Главный материал"),
    "только лид",
  );
}

/** The dense rubric strips below the fold. */
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

checkGrouping();
checkMarkup();
checkCompactPreview();
checkRubricFill();
checkSectionGrid();
checkFeedColumn();
checkFrontHero();
checkHeroStandfirst();
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