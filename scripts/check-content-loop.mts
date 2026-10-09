/**
 * The article engagement loop: the plate inside the body, the closing grid, the "most
 * read" rail.
 *
 * The interesting half is not the markup, it is the split. The body is a single
 * sanitised HTML string, and the plate has to land between two paragraphs of it — which
 * is the one transformation on this page that can visibly destroy an article: cut in the
 * wrong place and the reader gets half a `<blockquote>`, a headline with no text, or a
 * story that simply stops halfway. So the split is asserted on its own terms: the cut is
 * after a closing tag, the two halves reassemble into the original byte for byte, and an
 * article too short to hold a plate is returned untouched.
 *
 * Rendering is checked too, because "the function returns a string" and "the page shows a
 * card" are different claims, and the second one is the one a reader sees.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ContinueReading } from "../src/components/continue-reading";
import { LoopCard } from "../src/components/loop-card";
import { NowReading } from "../src/components/now-reading";
import { ReadAlsoBlock } from "../src/components/read-also-block";
import {
  composeLoopRows,
  countParagraphs,
  fillRanked,
  LOOP_PLACEMENTS,
  MIN_PARAGRAPHS_FOR_LOOP,
  pickStable,
  placementFor,
  splitAfterParagraph,
  splitForLoop,
  stableIndex,
} from "../src/lib/content-loop";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

/** Count of a substring, for asserting how many cards a block rendered. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const paragraph = (text: string) => `<p>${text}</p>`;
const BODY = [
  paragraph("Первый абзац"),
  paragraph("Второй абзац"),
  paragraph("Третий абзац"),
  paragraph("Четвёртый абзац"),
  paragraph("Пятый абзац"),
].join("");

const words = (count: number) => "слово ".repeat(count);
const NOW = new Date("2026-10-09T12:00:00+03:00");

function story(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: `material-${id}`,
    title: `Заголовок материала ${id}`,
    coverImage: `/uploads/${id}.jpg`,
    contentHtml: `<p>${words(540)}</p>`,
    publishedAt: NOW,
    createdAt: NOW,
    category: { name: "Расследования", slug: "investigations" },
    ...over,
  };
}

function checkParagraphCounting() {
  check(
    "Разбор тела: пустой текст — ноль абзацев",
    countParagraphs("") === 0,
    `${countParagraphs("")}`,
  );
  check(
    "Разбор тела: считаются все абзацы",
    countParagraphs(BODY) === 5,
    `${countParagraphs(BODY)} из 5`,
  );
  check(
    "Разбор тела: `</p >` с пробелом тоже закрывает абзац",
    countParagraphs("<p>текст</p >") === 1,
    `${countParagraphs("<p>текст</p >")}`,
  );
  check(
    "Разбор тела: закрывающий тег в коде не считается абзацем",
    countParagraphs("<pre>&lt;/p&gt;</pre><p>текст</p>") === 1,
    `${countParagraphs("<pre>&lt;/p&gt;</pre><p>текст</p>")}`,
  );
  check(
    "Разбор тела: абзац внутри цитаты считается и идёт по порядку",
    countParagraphs("<blockquote><p>цитата</p></blockquote><p>текст</p>") === 2,
    `${countParagraphs("<blockquote><p>цитата</p></blockquote><p>текст</p>")}`,
  );
}

function checkSplit() {
  const split = splitAfterParagraph(BODY, 2);

  check(
    "Врезка: разрез идёт сразу после закрывающего тега абзаца",
    split !== null && split.before.endsWith("</p>"),
    split ? split.before.slice(-24) : "нет разреза",
  );
  check(
    "Врезка: в первой части ровно два абзаца",
    split !== null && countParagraphs(split.before) === 2,
    split ? `${countParagraphs(split.before)}` : "нет разреза",
  );
  check(
    "Врезка: хвост начинается с открывающего тега, а не с середины",
    split !== null && split.after.startsWith("<p>"),
    split ? split.after.slice(0, 24) : "нет разреза",
  );
  check(
    "Врезка: половины складываются обратно в исходный текст",
    split !== null && split.before + split.after === BODY,
    split && split.before + split.after === BODY ? "байт в байт" : "не совпадает",
  );
  check(
    "Врезка: разрез за пределами тела не выдумывается",
    splitAfterParagraph(BODY, 9) === null && splitAfterParagraph(BODY, 0) === null,
    "за границами и нулевая позиция отклонены",
  );
  check(
    "Врезка: разрез после каждого абзаца даёт валидные половины",
    Array.from({ length: 5 }, (_, index) => splitAfterParagraph(BODY, index + 1)).every(
      (part) =>
        part !== null && part.before.endsWith("</p>") && part.before + part.after === BODY,
    ),
    "5 разрезов проверено",
  );
}

function checkPlacement() {
  const short = [1, 2].map((count) => placementFor("material", count));
  check(
    `Врезка: статья короче ${MIN_PARAGRAPHS_FOR_LOOP} абзацев остаётся нетронутой`,
    short.every((position) => position === null),
    `1 и 2 абзаца → ${short.join(", ")}`,
  );

  check(
    "Врезка: у трёх абзацев врезка идёт после второго",
    placementFor("material", 3) === 2,
    `${placementFor("material", 3)}`,
  );

  const positions = Array.from({ length: 60 }, (_, index) =>
    placementFor(`article-${index}`, 12),
  );
  const distinct = [...new Set(positions)];
  check(
    "Врезка: позиция выбирается из заданных",
    positions.every((position) =>
      position === null || (LOOP_PLACEMENTS as readonly number[]).includes(position),
    ),
    `${distinct.join(", ")}`,
  );
  const sameStory = Array.from({ length: 20 }, () => placementFor("article-7", 12));
  check(
    "Врезка: позиция не зависит от рендера — один id, один и тот же абзац",
    sameStory.every((position) => position === sameStory[0]),
    `${sameStory[0]} при 20 вызовах`,
  );
  check(
    "Врезка: разные материалы встают в разные места",
    distinct.length > 1,
    `${distinct.join(" и ")} на 60 материалах`,
  );
  check(
    "Врезка: после врезки всегда остаётся хотя бы один абзац",
    Array.from({ length: 60 }, (_, index) =>
      splitForLoop(BODY, `article-${index}`),
    ).every((split) => split !== null && split.after.trim().length > 0),
    "хвост непустой",
  );
}

function checkShortArticles() {
  const one = "<p>Один абзац — короткая справка.</p>";
  const two = "<p>Первый абзац.</p><p>Второй абзац.</p>";

  check(
    "Короткая статья: одна строка — врезки нет, текст не тронут",
    splitForLoop(one, "kratkaya-1") === null,
    "null",
  );
  check(
    "Короткая статья: две строки — врезки нет, текст не тронут",
    splitForLoop(two, "kratkaya-2") === null,
    "null",
  );
  check(
    "Короткая статья: три строки — врезка появляется",
    splitForLoop(two + paragraph("Третий"), "dlinnaya") !== null,
    "врезка есть",
  );
  check(
    "Короткая статья: пустой текст не роняет разбор",
    splitForLoop("", "pustaya") === null && countParagraphs("<") === 0,
    "без исключения",
  );
  check(
    "Короткая статья: незакрытый тег не даёт разреза",
    splitForLoop("<p>только начало", "obryv") === null,
    "null",
  );
}

function checkPicking() {
  const pool = ["a", "b", "c", "d"];

  check("Выбор: пустой список — null", pickStable([], "seed") === null, "null");
  check(
    "Выбор: индекс не выходит за границы",
    Array.from({ length: 40 }, (_, index) => stableIndex(`seed-${index}`, 5)).every(
      (value) => value >= 0 && value < 5,
    ),
    "0..4",
  );
  check(
    "Выбор: нулевая длина не делит на ноль",
    stableIndex("seed", 0) === 0,
    "0",
  );
  check(
    "Выбор: один и тот же материал берёт один и тот же сюжет",
    Array.from({ length: 20 }, () => pickStable(pool, "article-7")).every(
      (picked) => picked === pickStable(pool, "article-7"),
    ),
    `${pickStable(pool, "article-7")}`,
  );
  check(
    "Выбор: разные материалы берут разные сюжеты",
    new Set(Array.from({ length: 40 }, (_, index) => pickStable(pool, `article-${index}`)))
      .size > 1,
    `${new Set(Array.from({ length: 40 }, (_, index) => pickStable(pool, `article-${index}`))).size} из ${pool.length}`,
  );
  check(
    "Выбор: только из списка",
    Array.from({ length: 40 }, (_, index) =>
      pool.includes(pickStable(pool, `article-${index}`) ?? "нет"),
    ).every(Boolean),
    "все 40 из списка",
  );
}

function checkRows() {
  const popular = ["p1", "p2", "p3", "p4"].map((id) => ({ id }));
  const highlights = ["h1", "h2", "h3", "h4"].map((id) => ({ id }));

  const full = composeLoopRows(popular, highlights, ["current", "plate"], 3);
  const flat = [...full.popular, ...full.highlights].map((row) => row.id);

  check(
    "Сетка: обе строки заполнены",
    full.popular.length === 3 && full.highlights.length === 3,
    `${full.popular.length} и ${full.highlights.length}`,
  );
  check(
    "Сетка: текущий материал и сюжет врезки не повторяются",
    !flat.includes("current") && !flat.includes("plate"),
    flat.join(", "),
  );
  check(
    "Сетка: между строками нет повторов",
    new Set(flat).size === flat.length,
    `${flat.length} карточек, ${new Set(flat).size} уникальных`,
  );

  const thin = composeLoopRows([{ id: "p1" }], highlights.slice(0, 3), ["current"], 3);
  const thinFlat = [...thin.popular, ...thin.highlights].map((row) => row.id);
  check(
    "Сетка: нехватка материала делится поровну, а не «одна и три»",
    thin.popular.length === 2 &&
      thin.highlights.length === 2 &&
      new Set(thinFlat).size === 4,
    `${thin.popular.length} и ${thin.highlights.length}, уникальных ${new Set(thinFlat).size}`,
  );

  const empty = composeLoopRows([], [], [], 3);
  check(
    "Сетка: без материала блок пустой, а не из заглушек",
    empty.popular.length === 0 && empty.highlights.length === 0,
    "обе строки пусты",
  );

  const zero = composeLoopRows(popular, highlights, [], 0);
  check(
    "Сетка: нулевой размер не ломает сборку",
    zero.popular.length === 0 && zero.highlights.length === 0,
    "обе строки пусты",
  );

  const overflow = composeLoopRows(popular, highlights, [], 99);
  check(
    "Сетка: лишние карточки не дублируются между строками",
    overflow.popular.length === 4 &&
      overflow.highlights.length === 4 &&
      new Set([...overflow.popular, ...overflow.highlights].map((row) => row.id)).size === 8,
    `${overflow.popular.length} + ${overflow.highlights.length}, уникальных 8`,
  );
}

function checkPlateMarkup() {
  const html = renderToStaticMarkup(
    createElement(ReadAlsoBlock, { story: story("plate") }),
  );

  check(
    "Врезка: капс «ЧИТАЙТЕ ТАКЖЕ» на месте",
    html.includes("Читайте также") &&
      html.includes("text-xs font-semibold tracking-wider text-accent uppercase"),
    "капс найден",
  );
  check(
    "Врезка: ведёт на материал",
    html.includes('href="/news/material-plate"'),
    "ссылка найдена",
  );
  check(
    "Врезка: время чтения посчитано по тексту",
    html.includes("3 мин чтения"),
    "3 мин чтения",
  );
  check(
    "Врезка: тонкая рамка и приглушённая подложка",
    html.includes("border border-rule/80") && html.includes("bg-paper-dim/50"),
    "border-rule/80 + bg-paper-dim/50",
  );
  check(
    "Врезка: заголовок подчёркивается при наведении",
    html.includes("hover:underline") && html.includes("decoration-1 underline-offset-4"),
    "underline + decoration-1",
  );
  check(
    "Врезка: тач-зона заголовка не меньше 44px",
    html.includes("min-h-11"),
    "min-h-11",
  );
  check(
    "Врезка: рубрика подписана",
    html.includes("Расследования"),
    "Расследования",
  );
}

function checkGridMarkup() {
  const stories = Array.from({ length: 6 }, (_, index) => story(`card-${index}`));
  const html = renderToStaticMarkup(
    createElement(ContinueReading, {
      popular: stories.slice(0, 3),
      highlights: stories.slice(3),
    }),
  );

  check(
    "Сетка: заголовок блока на месте",
    html.includes("Продолжить чтение"),
    "Продолжить чтение",
  );
  check(
    "Сетка: обе группы подписаны",
    html.includes("Популярное в этой рубрике") &&
      html.includes("Главные расследования и события дня"),
    "две подписи",
  );
  check(
    "Сетка: шесть карточек",
    occurrences(html, "aspect-video") === 6,
    `${occurrences(html, "aspect-video")}`,
  );
  check(
    "Сетка: три в ряд на широком экране, один на телефоне",
    html.includes("grid-cols-1") && html.includes("sm:grid-cols-2") && html.includes("lg:grid-cols-3"),
    "grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-3",
  );
  check(
    "Сетка: карточка несёт рубрику, дату и время чтения",
    html.includes("Расследования") && html.includes("мин") && html.includes("<time"),
    "рубрика + дата + минуты",
  );
  check(
    "Сетка: без материала блок не рисуется",
    renderToStaticMarkup(
      createElement(ContinueReading, { popular: [], highlights: [] }),
    ) === "",
    "пустая разметка",
  );
}

function checkTrendingFallback() {
  const rows = (ids: string[]) => ids.map((id) => ({ id }));
  // The shape the failure had: two stories inside the two-day window, three slots short.
  const window = rows(["w1", "w2"]);
  const allTime = rows(["a1", "a2", "a3", "a4", "a5", "a6"]);
  const filled = fillRanked(window, allTime, 5);

  check(
    "«Сейчас читают»: тихий день добирается до пяти",
    filled.length === 5,
    `${filled.length} из 5`,
  );
  check(
    "«Сейчас читают»: сначала окно, потом общий список",
    filled[0]?.id === "w1" && filled[1]?.id === "w2" && filled[2]?.id === "a1",
    filled.map((row) => row.id).join(", "),
  );
  check(
    "«Сейчас читают»: повторов нет",
    new Set(filled.map((row) => row.id)).size === 5,
    `${new Set(filled.map((row) => row.id)).size} уникальных`,
  );

  // The overlap is the case that bites: the all-time list starts with the window's own
  // stories, and taking them twice would put a duplicate in the top five.
  const overlapping = fillRanked(window, rows(["w2", "w1", "a1", "a2", "a3"]), 5);
  check(
    "«Сейчас читают»: сюжет из окна не повторяется в общем списке",
    overlapping.length === 5 &&
      new Set(overlapping.map((row) => row.id)).size === 5,
    overlapping.map((row) => row.id).join(", "),
  );

  const full = fillRanked(rows(["w1", "w2", "w3", "w4", "w5"]), allTime, 5);
  check(
    "«Сейчас читают»: полное окно не разбавляется общим списком",
    full.map((row) => row.id).join(",") === "w1,w2,w3,w4,w5",
    full.map((row) => row.id).join(", "),
  );

  const short = fillRanked(window, rows(["a1"]), 5);
  check(
    "«Сейчас читают»: материала меньше пяти — отдаём что есть, без выдумок",
    short.length === 3,
    `${short.length} из 5`,
  );

  const none = fillRanked([], [], 5);
  check(
    "«Сейчас читают»: пустые оба списка дают пустой блок, а не заглушки",
    none.length === 0,
    "пусто",
  );
  check(
    "«Сейчас читают»: нулевой размер не ломает сборку",
    fillRanked(window, allTime, 0).length === 0,
    "пусто",
  );

  const over = fillRanked(rows(["w1", "w2", "w3", "w4", "w5", "w6"]), allTime, 5);
  check(
    "«Сейчас читают»: лишнее отбрасывается",
    over.length === 5,
    `${over.length} из 6`,
  );

  /*
    The page-level contract, and the bug it fixes.
    `fillRanked` used to build a private dedupe set, so it knew nothing about what the rest
    of the page had already printed. The lead story is in the page's `used` set from the
    moment it is chosen, and on the live front page it was then linked a second time in
    «Важное» and a third in «Спецтема» — measured, not predicted: one slug, three links.

    `window` holds w1 and w2, `allTime` holds a1..a6.
  */
  const used = new Set<string>(["w1"]);
  const urgent = fillRanked(window, allTime, 3, used);
  check(
    "Главная: лид не повторяется в «Важном»",
    urgent.map((row) => row.id).join() === "w2,a1,a2",
    urgent.map((row) => row.id).join(", "),
  );
  check(
    "Главная: ранжированный блок занимает свои места в used",
    used.has("w2") && used.has("a1") && used.has("a2"),
    "w2, a1, a2 в used",
  );

  const spec = fillRanked(allTime, allTime, 3, used);
  check(
    "Главная: «Спецтема» не берёт то, что уже показано",
    spec.map((row) => row.id).join() === "a3,a4,a5",
    spec.map((row) => row.id).join(", "),
  );
  const shownTogether = [...urgent, ...spec].map((row) => row.id);
  check(
    "Главная: два блока подряд не печатают один заголовок дважды",
    new Set(shownTogether).size === shownTogether.length,
    `${new Set(shownTogether).size} уникальных из ${shownTogether.length}`,
  );

  /*
    The exact sequence the front page runs: the lead is claimed, then two ranked blocks
    draw from overlapping candidate lists against one shared set. Before the fix, the second
    block handed back the lead.
  */
  const shared = new Set<string>(["lead"]);
  const first = fillRanked(rows(["lead", "b1", "b2"]), rows(["b3", "b4"]), 2, shared);
  const second = fillRanked(rows(["lead", "b1"]), rows(["b2", "b3", "b4", "b5"]), 2, shared);
  // `first` took b1 and b2 only — b3 was in its candidate list but did not make the cut, so
  // it stays available. `second` therefore returns b3 and b4, and never the lead.
  check(
    "Главная: лид не возвращается вторым блоком",
    first.map((r) => r.id).join() === "b1,b2" &&
      second.map((r) => r.id).join() === "b3,b4",
    `${first.map((r) => r.id).join(",")} / ${second.map((r) => r.id).join(",")}`,
  );
}

function checkNowReadingMarkup() {
  const articles = Array.from({ length: 5 }, (_, index) => ({
    id: `trend-${index}`,
    slug: `trend-${index}`,
    title: `Читают сейчас ${index + 1}`,
    publishedAt: NOW,
    createdAt: NOW,
  }));
  const html = renderToStaticMarkup(createElement(NowReading, { articles }));

  check(
    "Сейчас читают: заголовок с акцентной полосой",
    html.includes("Сейчас читают") && html.includes("border-l-2 border-accent"),
    "полоса + заголовок",
  );
  check(
    "Сейчас читают: пять строк",
    occurrences(html, "min-h-11") === 5,
    `${occurrences(html, "min-h-11")}`,
  );
  check(
    "Сейчас читают: нумерация 01…05 приглушёнными цифрами",
    html.includes(">01<") && html.includes(">05<") && html.includes("tabular-nums"),
    "01 и 05 есть",
  );
  check(
    "Сейчас читают: список семантический, цифры не дублируются озвучкой",
    html.includes("<ol") && occurrences(html, 'aria-hidden="true"') >= 5,
    "ol + aria-hidden на цифрах",
  );
  check(
    "Сейчас читают: без материала блок не рисуется",
    renderToStaticMarkup(createElement(NowReading, { articles: [] })) === "",
    "пустая разметка",
  );
}

function checkNoCoverCard() {
  const base = {
    id: "c1",
    slug: "material-bez-foto",
    title: "Материал без фотографии",
    contentHtml: `<p>${"слово ".repeat(540)}</p>`,
    publishedAt: NOW,
    createdAt: NOW,
    category: { name: "Дом и сад", slug: "home-garden" },
  };

  const withCover = renderToStaticMarkup(
    createElement(LoopCard as never, {
      story: { ...base, id: "c2", slug: "s-foto", coverImage: "/uploads/c.jpg" },
    }),
  );
  const withoutCover = renderToStaticMarkup(
    createElement(LoopCard as never, { story: { ...base, coverImage: null } }),
  );

  check(
    "Карточка цикла: с фото — плитка 16:9",
    withCover.includes("aspect-video") && !withCover.includes("/placeholder.png"),
    "aspect-video",
  );

  /*
    The grey plate. Six of them in the closing grid is a page of rectangles with the
    headlines lost between them, and `/placeholder.png` is exactly that: a bundled image
    carrying the site's mark. The assertion is on the source of the picture, not on a
    visual, because a missing class is invisible in a screenshot and unmissable here.
  */
  check(
    "Карточка цикла: без фото — никакой серой заглушки",
    !withoutCover.includes("/placeholder.png") && !withoutCover.includes("<img"),
    "ни картинки, ни заглушки",
  );
  check(
    "Карточка цикла: без фото — рамка 16:9 не резервируется",
    !withoutCover.includes("aspect-video"),
    "рамки нет",
  );
  check(
    "Карточка цикла: без фото — текстовый газетный формат",
    withoutCover.includes("--font-lora") &&
      withoutCover.includes("Дом и сад") &&
      withoutCover.includes("мин"),
    "рубрика + антиква + минуты",
  );
  check(
    "Карточка цикла: без фото — тач-зона и подчёркивание те же",
    withoutCover.includes("min-h-10") && withoutCover.includes("underline-offset-4"),
    "min-h-10 + underline",
  );
}

function checkSingleCard() {
  const html = renderToStaticMarkup(createElement(LoopCard, { story: story("one") }));

  check(
    "Карточка сетки: превью 16:9",
    html.includes("aspect-video"),
    "aspect-video",
  );
  check(
    "Карточка сетки: рубрика мелким жирным капсом",
    html.includes("tracking-[0.14em]") && html.includes("uppercase"),
    "капс",
  );
  check(
    "Карточка сетки: заголовок подчёркивается при наведении",
    html.includes("hover:underline") && html.includes("underline-offset-4"),
    "underline",
  );
  check(
    "Карточка сетки: тач-зона заголовка",
    html.includes("min-h-10"),
    "min-h-10",
  );
  /*
    The no-cover shape has its own block, `checkNoCoverCard`. It used to be asserted
    here as "a story with no cover still occupies a 16:9 frame" — which is exactly the
    grey plate this rework removed, so keeping the old line would pin that behaviour back
    in place the moment someone deleted the new block.
  */
}

checkParagraphCounting();
checkSplit();
checkPlacement();
checkShortArticles();
checkPicking();
checkRows();
checkPlateMarkup();
checkGridMarkup();
checkTrendingFallback();
checkNowReadingMarkup();
checkNoCoverCard();
checkSingleCard();

console.log("Цикл статьи: врезка в текст, закрывающая сетка, «Сейчас читают»\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
}
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;