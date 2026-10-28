/**
 * Чек-лист качества, спецврезки и их судьба на витрине и в мессенджерах.
 *
 * Запуск: npx tsx scripts/check-article-quality.mts
 *
 * Три вещи, которые нельзя проверить глазами на живой странице:
 *  1. переживает ли врезка санитайзер, а с ней — классы, по которым она узнаётся;
 *  2. превращается ли она в осмысленный текст для Telegram и ВК, а не в кашу из тегов;
 *  3. совпадает ли класс, который узел пишет в HTML, с классом, по которому он его находит
 *     обратно, — расхождение означает, что блок исчезнет при первом же открытии материала.
 */

import { Node } from "@tiptap/core";
import { readFileSync } from "node:fs";

import {
  LEAD_GOOD_MAX,
  LEAD_GOOD_MIN,
  TITLE_GOOD_MAX,
  TITLE_GOOD_MIN,
  WALL_HINT,
  articleQuality,
  longestWall,
  qualitySummary,
} from "../src/lib/article-quality";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { buildMessengerPost, htmlToPlainText } from "../src/lib/messenger-post";
import { buildPostText } from "../src/lib/vk-publisher";
import { editorExtensions } from "../src/app/admin/articles/components/editor-extensions";
import {
  ArticleCompare,
  ArticleFact,
  COMPARE_CLASS,
  COMPARE_CELL_CLASS,
  COMPARE_SIDE_AFTER,
  COMPARE_SIDE_BEFORE,
  CompareCell,
  FACT_CLASS,
  compareContent,
  factContent,
} from "../src/app/admin/articles/components/special-blocks";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const paragraph = (size: number, marker = "а") => marker.repeat(size);

/** HTML, который узел пишет в тело статьи. Собирается из тех же констант, что и узел. */
const FACT_HTML =
  `<div class="${FACT_CLASS} my-6 flex items-center gap-4 rounded-xl border border-rule/60 bg-paper-dim/60 p-4">` +
  `<p>14</p><p>маршрутов затронет новая транспортная схема</p></div>`;

const COMPARE_HTML =
  `<div class="${COMPARE_CLASS} my-6 grid grid-cols-1 gap-4 sm:grid-cols-2">` +
  `<div class="${COMPARE_CELL_CLASS} rounded-lg border-l-4 p-4 ${COMPARE_SIDE_BEFORE} border-red-500 bg-red-500/10">` +
  `<p>Было</p><p>Текст прежних условий</p></div>` +
  `<div class="${COMPARE_CELL_CLASS} rounded-lg border-l-4 p-4 ${COMPARE_SIDE_AFTER} border-emerald-500 bg-emerald-500/10">` +
  `<p>Стало</p><p>Что изменилось</p></div></div>`;

// --- чек-лист: границы -------------------------------------------------------

check(
  "Заголовок: 40–120 — зелёный, 39 и 121 — жёлтый, 10 — красный",
  articleQuality({ title: paragraph(TITLE_GOOD_MIN), lead: "x", contentHtml: "<p>t</p>" })[0].level === "good" &&
    articleQuality({ title: paragraph(TITLE_GOOD_MAX), lead: "x", contentHtml: "<p>t</p>" })[0].level === "good" &&
    articleQuality({ title: paragraph(TITLE_GOOD_MIN - 1), lead: "x", contentHtml: "<p>t</p>" })[0].level === "warn" &&
    articleQuality({ title: paragraph(TITLE_GOOD_MAX + 1), lead: "x", contentHtml: "<p>t</p>" })[0].level === "warn" &&
    articleQuality({ title: paragraph(10), lead: "x", contentHtml: "<p>t</p>" })[0].level === "bad",
  `${TITLE_GOOD_MIN}–${TITLE_GOOD_MAX}`,
);

check(
  "Лид: 120–280 — зелёный, 119 и 281 — жёлтый, 40 — красный",
  articleQuality({ title: "x", lead: paragraph(LEAD_GOOD_MIN), contentHtml: "<p>t</p>" })[1].level === "good" &&
    articleQuality({ title: "x", lead: paragraph(LEAD_GOOD_MAX), contentHtml: "<p>t</p>" })[1].level === "good" &&
    articleQuality({ title: "x", lead: paragraph(LEAD_GOOD_MIN - 1), contentHtml: "<p>t</p>" })[1].level === "warn" &&
    articleQuality({ title: "x", lead: paragraph(LEAD_GOOD_MAX + 1), contentHtml: "<p>t</p>" })[1].level === "warn" &&
    articleQuality({ title: "x", lead: paragraph(40), contentHtml: "<p>t</p>" })[1].level === "bad",
  `${LEAD_GOOD_MIN}–${LEAD_GOOD_MAX}`,
);

check(
  "Лид: пустой — красный с подсказкой, а не просто «0 символов»",
  (() => {
    const lead = articleQuality({ title: "x", lead: null, contentHtml: "<p>t</p>" })[1];
    return lead.level === "bad" && Boolean(lead.hint);
  })(),
  "подсказка есть",
);

// --- чек-лист: стена текста --------------------------------------------------

const longParagraph = `<p>${paragraph(300)}</p>`;
const fourLong = longParagraph.repeat(4);
const threeLong = longParagraph.repeat(3);

check(
  "Стена: четыре абзаца подряд по 300 знаков — замечание с той самой подсказкой",
  (() => {
    const result = articleQuality({ title: "x", lead: "x", contentHtml: fourLong })[2];
    return result.level === "warn" && result.hint === WALL_HINT;
  })(),
  WALL_HINT,
);

check(
  "Стена: три абзаца — не стена",
  articleQuality({ title: "x", lead: "x", contentHtml: threeLong })[2].level === "good",
  `абзацев: 3, знаков: ${longestWall(threeLong).chars}`,
);

check(
  "Стена: четыре абзаца, но с подзаголовком посередине — не стена",
  articleQuality({
    title: "x",
    lead: "x",
    contentHtml: `${longParagraph.repeat(2)}<h2>Что изменилось</h2>${longParagraph.repeat(2)}`,
  })[2].level === "good",
  "H2 рвёт",
);

check(
  "Стена: четыре абзаца, но с фото посередине — не стена",
  articleQuality({
    title: "x",
    lead: "x",
    contentHtml: `${longParagraph.repeat(2)}<figure><img src="/uploads/a.jpg"></figure>${longParagraph.repeat(2)}`,
  })[2].level === "good",
  "фото рвёт",
);

check(
  "Стена: четыре коротких абзаца — не стена (знаков меньше 900)",
  articleQuality({ title: "x", lead: "x", contentHtml: longParagraph.replace("а".repeat(300), "а".repeat(60)).repeat(4) })[2].level === "good",
  "длина не дотянула",
);

check(
  "Стена: пустой текст — красный, а не «всё хорошо»",
  articleQuality({ title: "x", lead: "x", contentHtml: "" })[2].level === "bad",
  "текста нет",
);

// --- чек-лист: обложка и источник --------------------------------------------

check(
  "Обложка без источника — подсказка указать источник",
  (() => {
    const result = articleQuality({ title: "x", lead: "x", contentHtml: "<p>t</p>", coverImage: "/uploads/a.jpg" })[3];
    return result.level === "warn" && (result.hint ?? "").includes("источник");
  })(),
  "источник",
);

check(
  "Обложка с источником — зелёный; без обложки — жёлтый, но с другим советом",
  articleQuality({ title: "x", lead: "x", contentHtml: "<p>t</p>", coverImage: "/uploads/a.jpg", photoSource: "РИА" })[3].level === "good" &&
    articleQuality({ title: "x", lead: "x", contentHtml: "<p>t</p>", coverImage: "" })[3].level === "warn",
  "good / warn",
);

check(
  "Сводка: склонение и худший уровень",
  qualitySummary([
    { id: "title", label: "T", level: "warn", detail: "" },
    { id: "lead", label: "L", level: "warn", detail: "" },
  ]).text.startsWith("2 подсказки") &&
    qualitySummary([{ id: "title", label: "T", level: "bad", detail: "" }]).text.includes("требуют правки"),
  "русские склонения",
);

// --- санитайзер ---------------------------------------------------------------

const saved = sanitizeArticleHtml(`<p>До.</p>${FACT_HTML}${COMPARE_HTML}<p>После.</p>`);

check(
  "Санитайзер: цифра и сравнение пережили чистку целиком",
  saved.includes(FACT_CLASS) &&
    saved.includes(COMPARE_CLASS) &&
    saved.includes(COMPARE_CELL_CLASS) &&
    saved.includes(COMPARE_SIDE_BEFORE) &&
    saved.includes(COMPARE_SIDE_AFTER) &&
    saved.includes("маршрутов затронет новая транспортная схема") &&
    saved.includes("Текст прежних условий") &&
    saved.includes("Что изменилось"),
  `${saved.length} знаков после чистки`,
);

check(
  "Санитайзер: утилитарные классы сетки и рамок на месте",
  ["grid", "sm:grid-cols-2", "border-l-4", "bg-red-500/10", "bg-emerald-500/10", "rounded-xl"].every(
    (name) => saved.includes(name),
  ),
  "grid / border-l-4 / bg-*-500/10",
);

check(
  "Санитайзер: опасное по-прежнему вырезается",
  !sanitizeArticleHtml(`<div class="${FACT_CLASS}" onclick="alert(1)"><p>x</p></div>`).includes("onclick"),
  "onclick вырезан",
);

// --- синдикация ---------------------------------------------------------------

const telegram = buildMessengerPost({
  title: "Реформа транспорта",
  contentHtml: `${FACT_HTML}${COMPARE_HTML}`,
  slug: "reforma",
  categoryName: "Общество",
  siteUrl: "https://eartnews.ru",
});

check(
  "Telegram: врезки уходят текстом, без тегов и без потерянных слов",
  telegram.text.includes("14") &&
    telegram.text.includes("маршрутов затронет новая транспортная схема") &&
    telegram.text.includes("Было") &&
    telegram.text.includes("Стало") &&
    telegram.text.includes("Что изменилось") &&
    !/<(?:div|span|p)\b/.test(telegram.body),
  JSON.stringify(telegram.body.slice(0, 80)),
);

const vk = buildPostText({
  title: "Реформа транспорта",
  contentHtml: `${FACT_HTML}${COMPARE_HTML}`,
  slug: "reforma",
  categoryName: "Общество",
});
check(
  "ВК: те же слова, без тегов",
  vk.includes("14") && vk.includes("Было") && vk.includes("Стало") && !/<(?:div|span|p)\b/.test(vk),
  JSON.stringify(vk.slice(0, 80)),
);

check(
  "Плоский текст: метки сторон остаются отдельными строками",
  htmlToPlainText(COMPARE_HTML).includes("Было\n\nТекст прежних условий"),
  JSON.stringify(htmlToPlainText(COMPARE_HTML)),
);

// --- схема редактора ----------------------------------------------------------

const names = editorExtensions()
  .map((extension) => extension.name)
  .filter(Boolean);

check(
  "Схема: оба узла и колонка зарегистрированы",
  names.includes("articleFact") && names.includes("articleCompare") && names.includes("compareCell"),
  names.filter((name) => name.startsWith("article") || name === "compareCell").join(", "),
);

/**
 * Класс, который узел пишет в HTML, обязан совпадать с тем, по которому он его находит обратно.
 * Расхождение — это молчаливая потеря блока при первом сохранении, и никакой TypeScript его не
 * увидит: оба значения строки.
 */
function classFromSpec(spec: unknown): string {
  if (!Array.isArray(spec)) return "";
  const attrs = spec[1] as { class?: string } | undefined;
  return typeof attrs?.class === "string" ? attrs.class : "";
}

/*
  Конфиги TipTap типизированы через `this`, поэтому вызываются приведением к простой функции.
  Наши узлы `this` не используют: разметка и селекторы — константы модуля, и это как раз то, что
  проверка и должна подтвердить.
*/
function renderSpec(node: Node): unknown {
  const fn = node.config.renderHTML as unknown as ((props: unknown) => unknown) | undefined;
  return fn?.({ node: {}, HTMLAttributes: {}, decorations: [], editor: undefined, extension: node });
}

function selectorsOf(node: Node): string {
  const fn = node.config.parseHTML as unknown as (() => { tag?: unknown }[]) | undefined;
  return (fn?.() ?? []).map((rule) => String(rule.tag ?? "")).join(" ");
}

for (const [node, marker] of [
  [ArticleFact, FACT_CLASS],
  [ArticleCompare, COMPARE_CLASS],
  [CompareCell, COMPARE_CELL_CLASS],
] as const) {
  const rendered = classFromSpec(renderSpec(node));
  const selectors = selectorsOf(node);
  check(
    `Схема: ${node.name} пишет и находит один и тот же класс`,
    rendered.includes(marker) && selectors.includes(marker),
    `${marker}: в разметке ${rendered.includes(marker)}, в селекторе ${selectors.includes(marker)}`,
  );
}

check(
  "Вставка: начальное содержимое — две колонки и два абзаца",
  (() => {
    const fact = factContent();
    const compare = compareContent();
    const cells = (compare.content ?? []) as { attrs?: { side?: string } }[];
    return (
      fact.type === "articleFact" &&
      (fact.content ?? []).length === 2 &&
      compare.type === "articleCompare" &&
      cells.length === 2 &&
      cells[0]?.attrs?.side === "before" &&
      cells[1]?.attrs?.side === "after"
    );
  })(),
  "articleFact(2 абзаца), articleCompare(before, after)",
);

// --- подключение к интерфейсу -------------------------------------------------

const formSource = readFileSync(
  new URL("../src/app/admin/articles/components/article-form.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../src/app/admin/articles/components/content-editor.tsx", import.meta.url),
  "utf8",
);

check(
  "Редактор: чек-лист стоит в сайдбаре и получает все пять полей",
  formSource.includes("<QualityChecklist") &&
    ["title={title}", "lead={lead}", "contentHtml={contentHtml}", "coverImage={coverImage}", "photoSource={photoSource}"].every(
      (prop) => formSource.includes(prop),
    ),
  "QualityChecklist в PublishSidebar",
);

check(
  "Тулбар: обе кнопки спецврезок вставляют узлы через общую точку вставки",
  editorSource.includes("Акцентная цифра / Факт") &&
    editorSource.includes("Было / Стало") &&
    editorSource.includes("block: factContent") &&
    editorSource.includes("block: compareContent") &&
    editorSource.includes("insertBlockAtWorkPoint(editor, action.block(), caretPlaced)"),
  "factContent + compareContent → insertBlockAtWorkPoint",
);

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);
