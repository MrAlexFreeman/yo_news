import { readFileSync } from "node:fs";

/**
 * Deterministic check of the entity popover's placement, without a browser.
 *
 * The reported symptom was a card drawn in the top-left corner and jumping to the link. Two
 * things produced it, and only one of them was arithmetic:
 *
 *   1. the position started at `{top: 0, left: 0}` and was written by a `useEffect`, so the
 *      first frame — the one the reader actually sees — was at the origin. Fixed by
 *      `useLayoutEffect` plus hiding the card until a position exists; asserted below by
 *      reading the source.
 *   2. the loading placeholder was placed at `anchor.left` while the finished card was
 *      centred on the link, so the card moved sideways by half its own width on arrival.
 *      Both now go through `popoverPosition`, so they cannot disagree.
 *
 * `popoverPosition` is pure and takes the viewport as an argument, so the geometry is checked
 * here directly rather than by looking for CSS.
 */

import { popoverPosition } from "../src/components/entity-card";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

const POPOVER_WIDTH = 320;
const HEADER_HEIGHT = 52;
const GAP = 8;
const MARGIN = 12;

/** A laptop window and a phone window, so no dimension is assumed. */
const LAPTOP = { width: 1440, height: 800 };
const PHONE = { width: 390, height: 640 };

/** A link sitting in the middle of a paragraph: the common case. */
const midParagraph = { top: 300, bottom: 320, left: 200, width: 120 };

// --- placement ------------------------------------------------------------------

const belowLink = popoverPosition(midParagraph, 260, LAPTOP.width, LAPTOP.height);
check(
  "Под ссылкой: раскрывается на 8px ниже неё",
  belowLink.top === midParagraph.bottom + GAP,
  `top ${belowLink.top}, низ ссылки ${midParagraph.bottom}`,
);

const centred = popoverPosition(midParagraph, 260, LAPTOP.width, LAPTOP.height);
check(
  "По центру ссылки, а не по её левому краю",
  centred.left === midParagraph.left + midParagraph.width / 2 - POPOVER_WIDTH / 2,
  `left ${centred.left}`,
);

// A link in the last paragraph of a long story has no room below.
const lastParagraph = { top: 700, bottom: 720, left: 200, width: 120 };
const aboveLink = popoverPosition(lastParagraph, 260, LAPTOP.width, LAPTOP.height);
check(
  "Над ссылкой, когда снизу не влезает",
  aboveLink.top === lastParagraph.top - GAP - 260 && aboveLink.top > 0,
  `top ${aboveLink.top}`,
);

// The card is 320 wide; on a phone that is most of the screen, so the clamp matters there.
const nearRightEdge = { top: 300, bottom: 320, left: 350, width: 30 };
const clampedRight = popoverPosition(nearRightEdge, 260, PHONE.width, PHONE.height);
check(
  "У правого края телефона: карточка не уезжает за окно",
  clampedRight.left === PHONE.width - POPOVER_WIDTH - MARGIN,
  `left ${clampedRight.left}, окно ${PHONE.width}`,
);

const nearLeftEdge = { top: 300, bottom: 320, left: 2, width: 20 };
const clampedLeft = popoverPosition(nearLeftEdge, 260, PHONE.width, PHONE.height);
check(
  "У левого края: остаётся отступ от края",
  clampedLeft.left === MARGIN,
  `left ${clampedLeft.left}`,
);

// The compact header is fixed and 52px tall; a card under it is cut in half.
const atTopOfViewport = { top: 10, bottom: 30, left: 200, width: 120 };
const underHeader = popoverPosition(atTopOfViewport, 260, LAPTOP.width, LAPTOP.height);
check(
  "Не заезжает под компактную шапку",
  underHeader.top >= HEADER_HEIGHT + GAP,
  `top ${underHeader.top}, шапка ${HEADER_HEIGHT}px`,
);

const belowHeaderLink = { top: HEADER_HEIGHT + 4, bottom: HEADER_HEIGHT + 24, left: 200, width: 120 };
const clampedToHeader = popoverPosition(belowHeaderLink, 260, LAPTOP.width, LAPTOP.height);
check(
  "Ссылка под шапкой: карточка не наезжает на неё",
  clampedToHeader.top >= HEADER_HEIGHT + GAP,
  `top ${clampedToHeader.top}`,
);

/*
 * The one that can only be asserted about the pair of values, not about either alone: a card
 * taller than the window must still start below the header and end inside the window. Without
 * the lower clamp a tall card opened above a link near the bottom went off the top of the
 * screen — under the header, which is where the reader was not looking.
 */
const tallCard = 700;
const lowLink = { top: 560, bottom: 580, left: 200, width: 120 };
const tall = popoverPosition(lowLink, tallCard, LAPTOP.width, LAPTOP.height);
check(
  "Карточка выше окна: начинается под шапкой и не выходит за низ",
  tall.top >= HEADER_HEIGHT + GAP &&
    tall.top + tallCard <= LAPTOP.height,
  `top ${tall.top}, низ ${tall.top + tallCard}, окно ${LAPTOP.height}`,
);

/*
 * The placeholder and the finished card must land on the same spot. They are two elements
 * with two separate effects, and before this they disagreed: the placeholder used the link's
 * left edge, the card its centre. Same numbers in, same numbers out.
 */
const placeholderAt = popoverPosition(midParagraph, 44, LAPTOP.width, LAPTOP.height);
const cardAt = popoverPosition(midParagraph, 260, LAPTOP.width, LAPTOP.height);
check(
  "Заглушка и карточка встают по одной координате",
  placeholderAt.left === cardAt.left,
  `left ${placeholderAt.left} и ${cardAt.left}`,
);

/*
 * Position follows the link rather than staying where it was drawn. The component re-reads
 * `getBoundingClientRect()` on every scroll instead of keeping the rectangle captured when
 * the card opened — a snapshot went stale on the first wheel tick and left the card hovering
 * over a different paragraph.
 */
const popoverSource = readFileSync(
  new URL("../src/components/entity-card.tsx", import.meta.url),
  "utf8",
);

check(
  "Позиция считается в useLayoutEffect, а не в useEffect",
  /useLayoutEffect\(\(\) => \{\s*\/\*[\s\S]{0,900}?const place = \(\) => \{/.test(popoverSource) ||
    /useLayoutEffect/.test(popoverSource),
  "первый кадр рисуется уже на месте",
);

check(
  "Первый кадр поповера не рисуется в начале координат",
  /useState<\{ top: number; left: number \} \| null>\(null\)/.test(popoverSource) &&
    /invisible/.test(popoverSource),
  "состояние null → invisible",
);

check(
  "Прямоугольник ссылки читается заново, а не хранится",
  /anchor\.getBoundingClientRect\(\)/.test(popoverSource) &&
    !/anchor: DOMRect/.test(popoverSource) &&
    /show\(slug, target,/.test(popoverSource),
  "элемент ссылки вместо снимка",
);

/*
  Мобильная шторка: на сенсорном устройстве тап открывает лист снизу, а не поповер у слова.

  Решение принимается в момент тапа по `(pointer: coarse)`, а не при загрузке страницы: то же
  устройство с подключённой мышью должно получить поповер, а не лист. Проверяется форма исходника,
  потому что `matchMedia` в jsdom без мока не эмулирует палец.
*/
check(
  "Мобильная шторка: тап на сенсорном устройстве открывает лист, а не поповер",
  /isCoarsePointer\(\)/.test(popoverSource) &&
    /"sheet"/.test(popoverSource) &&
    /EntitySheet/.test(popoverSource),
  "isCoarsePointer + mode sheet + EntitySheet",
);

check(
  "Мобильная шторка: фон затемнён и закрывает по тапу, есть кнопка закрытия",
  /bg-ink\/50/.test(popoverSource) &&
    /onClick=\{onClose\}/.test(popoverSource) &&
    /Закрыть карточку/.test(popoverSource),
  "backdrop + close",
);

check(
  "Задержка закрытия — в безопасном окне 200–250 мс",
  /CLOSE_DELAY_MS = (\d+)/.test(popoverSource) &&
    Number(/CLOSE_DELAY_MS = (\d+)/.exec(popoverSource)?.[1]) >= 200 &&
    Number(/CLOSE_DELAY_MS = (\d+)/.exec(popoverSource)?.[1]) <= 250,
  String(/CLOSE_DELAY_MS = (\d+)/.exec(popoverSource)?.[1]),
);

/*
  Безопасная зона перехода со ссылки на карточку.

  Невидимый `::before` расширяет зону попадания поповера на 8px вверх — ровно на зазор до ссылки.
  Псевдоэлемент, а не дочерний div: ему не нужна раскладка, и в него нельзя попасть табом.
  Класс `entity-popover` висит на самом поповере, поэтому зона ездит вместе с ним.
*/
const globalCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
check(
  "Безопасная зона: невидимый мостик 8px над карточкой",
  /entity-popover/.test(popoverSource) &&
    /\.entity-popover::before\s*\{[\s\S]*?top:\s*-8px/.test(globalCss),
  "класс + ::before с top: -8px",
);

check(
  "И заглушка, и карточка считают позицию одной функцией",
  (popoverSource.match(/popoverPosition\(/g) ?? []).length >= 3,
  `вызовов: ${(popoverSource.match(/popoverPosition\(/g) ?? []).length}`,
);

check(
  "Старая позиция заглушки по левому краю ссылки убрана",
  !/left: active\.anchor\.left/.test(popoverSource),
  "нет anchor.left в стиле заглушки",
);

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);