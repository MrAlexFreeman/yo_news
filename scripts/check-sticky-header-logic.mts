import { readFileSync } from "node:fs";

/**
 * Deterministic check of the sticky header's threshold logic, without a browser.
 *
 * The component reads scroll depth through an IntersectionObserver on a 1px marker placed
 * at 120px in the document. What decides whether the compact bar appears is entirely in
 * "does the marker still intersect the viewport", so that is simulated here: the marker is
 * a document-space interval, the viewport a document-space window, and the observer fires
 * exactly when the two stop overlapping.
 *
 * This is the part a class assertion cannot reach. The CSS is a constant in the file; the
 * 120 is a constant in the file; but whether those two constants agree about when the bar
 * appears is arithmetic, and arithmetic is worth asserting.
 */

/** Must match COMPACT_AFTER_PX in src/components/header-shell.tsx. */
const COMPACT_AFTER_PX = 120;

type ObserverState = { intersecting: boolean };

/**
 * What the component sees, given a scroll position.
 *
 * The marker occupies `[120, 121)` in document space. The viewport occupies
 * `[scrollY, scrollY + innerHeight)`. The observer reports `isIntersecting = true` while
 * they overlap, and the component sets `compact = !isIntersecting`.
 */
function stateAt(scrollY: number, viewportHeight: number): ObserverState {
  const markerTop = COMPACT_AFTER_PX;
  const markerBottom = markerTop + 1;

  const viewportTop = scrollY;
  const viewportBottom = scrollY + viewportHeight;

  const intersecting =
    markerBottom > viewportTop && markerTop < viewportBottom;

  return { intersecting };
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

const shellSource = readFileSync(
  new URL("../src/components/header-shell.tsx", import.meta.url),
  "utf8",
);

// A laptop and a phone, so the viewport height is not assumed.
for (const [label, viewportHeight] of [
  ["ноутбук", 800],
  ["телефон", 640],
] as const) {
  const compactAt = (scrollY: number) => !stateAt(scrollY, viewportHeight).intersecting;

  check(
    `Порог (${label}): наверху страницы панель спрятана`,
    !compactAt(0),
    "compact = false на 0px",
  );
  check(
    `Порог (${label}): ровно на границе 120px панель ещё спрятана`,
    !compactAt(119),
    "compact = false на 119px",
  );
  check(
    `Порог (${label}): сразу за границей панель выходит`,
    compactAt(121),
    "compact = true на 121px",
  );
  check(
    `Порог (${label}): глубже порога панель остаётся`,
    compactAt(400) && compactAt(4000),
    "compact = true на 400px и 4000px",
  );
  check(
    `Порог (${label}): возврат наверх снова раскрывает мачту`,
    compactAt(500) && !compactAt(0),
    "500px → 0px",
  );

  /*
   * The marker has to be a point, not a slab. A 100px-tall marker would keep intersecting
   * the viewport until scroll ≈ 20px and fire far too early, so the marker height and the
   * threshold have to be read out of the component rather than assumed here.
   */
  const { threshold, markerHeight } = readConstants(shellSource);

  check(
    `Порог (${label}): константы компонента — ${threshold}px, маркер ${markerHeight}px`,
    threshold === COMPACT_AFTER_PX && markerHeight === 1,
    `${threshold}px / ${markerHeight}px`,
  );

  /*
   * With the real values substituted, the arithmetic above is what the reader gets: the
   * bar appears one pixel past the threshold, not at the masthead's bottom edge.
   */
  const realTop = threshold;
  const realBottom = realTop + markerHeight;
  const firesAt = (scrollY: number, vh: number) =>
    !(realBottom > scrollY && realTop < scrollY + vh);

  check(
    `Порог (${label}): реальные константы дают переход на ${threshold + markerHeight}px`,
    !firesAt(threshold, viewportHeight) && firesAt(threshold + markerHeight, viewportHeight),
    `${!firesAt(threshold, viewportHeight) ? "нет" : "да"} на ${threshold}px, ${
      firesAt(threshold + markerHeight, viewportHeight) ? "да" : "нет"
    } на ${threshold + markerHeight}px`,
  );
}

/** The two numbers that decide when the bar appears, taken from the component itself. */
function readConstants(source: string) {
  const threshold = Number(
    /const COMPACT_AFTER_PX = (\d+);/.exec(source)?.[1] ?? Number.NaN,
  );
  const markerHeight = Number(/height: (\d+) \}/.exec(source)?.[1] ?? Number.NaN);
  return { threshold, markerHeight };
}

/*
 * The one that would actually bite. A `sticky` bar occupies flow space, so it grows the
 * document by its own height the moment it appears; `fixed` costs the page nothing. The
 * class is asserted on the real source because that is the whole mechanism, and the reason
 * the design departs from the `sticky top-0` the brief suggested.
 */
check(
  "Панель вне потока: sticky сдвинул бы документ на 52px",
  shellSource.includes('"fixed inset-x-0 top-0 z-50"') &&
    !/className="[^"]*\bsticky\b[^"]*"/.test(shellSource),
  "fixed, sticky не используется",
);

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);