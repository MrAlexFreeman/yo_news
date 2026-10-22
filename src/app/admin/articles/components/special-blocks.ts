/**
 * Два спецблока визуального сторителлинга: «акцентная цифра» и «было / стало».
 *
 * **Почему это узлы схемы, а не вставка готового HTML.** Редактор — TipTap (ProseMirror), и его
 * схема не знает `div` с произвольными классами. Вставленный как HTML блок исчез бы при первом же
 * открытии и сохранении материала — молча, вместе с текстом внутри, ровно как когда-то исчезала
 * строка источника цитаты. Узел в схеме — единственный способ, которым блок переживает
 * круг «сохранён → открыт → снова сохранён».
 *
 * **Почему в разметке есть маркерный класс.** Хранится HTML, а не JSON, поэтому на обратном пути
 * узел узнаётся по классу. Санитайзер (`ALLOW_DATA_ATTR: false`) вырезает `data-*`, так что
 * `article-fact` и `article-compare` — единственное, за что можно зацепиться; они же становятся
 * якорем для стилей. Массив Tailwind-классов из задания сохранён полностью, маркер добавлен к нему.
 *
 * Текст внутри блока — обычные абзацы, а не поля формы: писатель правит цифру и подпись прямо в
 * тексте, как любой другой абзац. Первый абзац играет роль крупной цифры (или метки «Было»), и это
 * задано стилями, а не структурой, — поэтому текст остаётся текстом и в базе, и в мессенджерах.
 */

import { Node, type JSONContent } from "@tiptap/core";

/** Маркер «акцентной цифры». По нему узел находится в сохранённом HTML. */
export const FACT_CLASS = "article-fact";

/** Маркер сетки сравнения. */
export const COMPARE_CLASS = "article-compare";

/** Маркер колонки сравнения. */
export const COMPARE_CELL_CLASS = "article-compare__cell";

/** Классы стороны: по ним узел узнаёт «было» и «стало» после перезагрузки. */
export const COMPARE_SIDE_BEFORE = "article-compare__cell--before";
export const COMPARE_SIDE_AFTER = "article-compare__cell--after";

export type CompareSide = "before" | "after";

/**
 * Акцентная цифра: одна крупная величина и одна фраза, которая её объясняет.
 *
 * `paragraph+` — потому что первая строка это цифра, остальные — подпись; писателю не нужно
 * ничего настраивать, он просто пишет две строки. Стили делают первую крупной.
 */
export const ArticleFact = Node.create({
  name: "articleFact",
  group: "block",
  content: "paragraph+",
  defining: true,

  parseHTML() {
    return [{ tag: `div.${FACT_CLASS}` }];
  },

  /*
    `HTMLAttributes` намеренно не сливаются с нашими: `mergeAttributes` склеивает `class`, и
    каждый цикл «сохранить → открыть» добавлял бы в класс ещё одну копию списка. У узла нет
    собственных атрибутов, так что терять нечего.
  */
  renderHTML() {
    return [
      "div",
      {
        class: `${FACT_CLASS} my-6 flex items-center gap-4 rounded-xl border border-rule/60 bg-paper-dim/60 p-4`,
      },
      0,
    ];
  },
});

/** Колонка сравнения: метка («Было»/«Стало») первым абзацем и текст дальше. */
export const CompareCell = Node.create({
  name: "compareCell",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      /*
        Сторона хранится классом, а не `data-side`: санитайзер вырезает все `data-*`
        (`ALLOW_DATA_ATTR: false`), и после публикации сторона потерялась бы — обе колонки
        стали бы одного цвета. Класс переживает санитайзер и читается обратно тем же селектором.
      */
      side: {
        default: "before",
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute("class") ?? "").includes(COMPARE_SIDE_AFTER) ? "after" : "before",
        renderHTML: (attributes: Record<string, unknown>) => ({
          class:
            attributes.side === "after"
              ? `${COMPARE_SIDE_AFTER} border-emerald-500 bg-emerald-500/10`
              : `${COMPARE_SIDE_BEFORE} border-red-500 bg-red-500/10`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div.${COMPARE_CELL_CLASS}` }];
  },

  renderHTML() {
    return ["div", { class: `${COMPARE_CELL_CLASS} rounded-lg border-l-4 p-4` }, 0];
  },
});

/** Сетка из двух колонок: ровно две стороны, третьей у сравнения не бывает. */
export const ArticleCompare = Node.create({
  name: "articleCompare",
  group: "block",
  content: "compareCell compareCell",
  defining: true,

  parseHTML() {
    return [{ tag: `div.${COMPARE_CLASS}` }];
  },

  renderHTML() {
    return [
      "div",
      { class: `${COMPARE_CLASS} my-6 grid grid-cols-1 gap-4 sm:grid-cols-2` },
      0,
    ];
  },
});

/** Абзац из одной строки — строительный блок начального содержимого. */
function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/**
 * Начальное содержимое «цифры».
 *
 * Заглушка показывает форму, а не подсказывает содержание: цифру и фразу писатель заменяет
 * своими, и обе строки остаются обычным текстом.
 */
export function factContent(
  value = "14",
  caption = "маршрутов затронет новая транспортная схема",
): JSONContent {
  return { type: "articleFact", content: [paragraph(value), paragraph(caption)] };
}

/** Начальное содержимое «было / стало». */
export function compareContent(
  before = "Текст прежних условий…",
  after = "Что изменилось…",
): JSONContent {
  return {
    type: "articleCompare",
    content: [
      { type: "compareCell", attrs: { side: "before" }, content: [paragraph("Было"), paragraph(before)] },
      { type: "compareCell", attrs: { side: "after" }, content: [paragraph("Стало"), paragraph(after)] },
    ],
  };
}
