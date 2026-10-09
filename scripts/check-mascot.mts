import { existsSync, readFileSync, statSync } from "node:fs";

/**
 * Checks for the editorial mascot: the corner it sits in, the sheets it needs, and the
 * degradation when they are not there.
 *
 * The interesting assertions are the negative ones. A mascot that renders happily over a
 * missing sprite sheet produces an invisible, focusable button in the corner of every page,
 * and nothing about that failure is visible in a screenshot — it only shows up in the tab
 * order. So the checks here read the component source rather than its output, and assert
 * that the guard exists.
 */
export function checkMascot() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const widgetSource = readFileSync(
    new URL("../src/components/mascot-widget.tsx", import.meta.url),
    "utf8",
  );
  const figureSource = readFileSync(
    new URL("../src/components/mascot-figure.tsx", import.meta.url),
    "utf8",
  );
  const layoutSource = readFileSync(
    new URL("../src/app/(public)/layout.tsx", import.meta.url),
    "utf8",
  );

  /* ---- position ---- */

  check(
    "Маскот: правый нижний угол, поверх контента",
    widgetSource.includes("fixed right-4 bottom-4") && widgetSource.includes("z-30"),
    "fixed right-4 bottom-4 z-30",
  );

  check(
    "Маскот: скрыт на смартфонах и планшетах",
    widgetSource.includes("hidden md:block"),
    "hidden md:block",
  );

  /*
    The size is asserted as a number rather than as the string `76`, because the constant is
    what the component actually renders with and the stylesheet only carries its footprint.
  */
  const sizeMatch = /const MASCOT_SIZE = (\d+);/.exec(widgetSource);
  const size = sizeMatch ? Number(sizeMatch[1]) : 0;
  check(
    "Маскот: размер 70–80 px",
    size >= 70 && size <= 80,
    size ? `${size}px` : "константа не найдена",
  );

  /*
    `pointer-events` is inherited, and that is the whole reason this check exists. The box
    has to be `none` so its transparent corners do not swallow clicks meant for whatever is
    underneath, and the cat has to set `auto` back — otherwise the mascot is present,
    visible, and completely dead to the pointer.
  */
  check(
    "Маскот: пустая рамка не перехватывает клики",
    widgetSource.includes("pointer-events-none"),
    "pointer-events-none на контейнере",
  );
  check(
    "Маскот: сам кот кликабелен (pointer-events наследуется)",
    widgetSource.includes('className="pointer-events-auto"'),
    "pointer-events-auto на кнопке",
  );

  /* ---- client-only, and why ---- */

  check(
    "Маскот: клиентский компонент",
    widgetSource.trimStart().startsWith('"use client"'),
    "use client",
  );

  check(
    "Маскот: грузится без SSR, отдельным чанком",
    widgetSource.includes("dynamic(") && widgetSource.includes("ssr: false"),
    "next/dynamic + ssr: false",
  );

  /*
    `ssr: false` throws when it appears in a Server Component. The layout that mounts the
    widget is a server component, so the call has to stay inside the widget itself — which
    is where it is, and this asserts the layout did not grow its own.
  */
  check(
    "Маскот: ssr:false не утёк в серверный компонент",
    !layoutSource.includes("ssr: false") && !layoutSource.includes("dynamic("),
    "динамический импорт только внутри виджета",
  );

  /* ---- the two sheets ---- */

  for (const sheet of ["cat-directions.webp", "cat-reactions.webp"]) {
    const path = new URL(`../public/mascots/${sheet}`, import.meta.url);
    const present = existsSync(path);
    check(
      `Маскот: спрайт ${sheet} на месте`,
      present,
      present ? `${Math.round(statSync(path).size / 1024)} КБ` : "файла нет",
    );

    if (present) {
      /*
        A 3x3 sheet has to be square. The component slices it with `background-size: 300%`
        and steps the position by thirds, so a sheet of the wrong shape does not error — it
        silently shows a cropped fragment of the cat, which is precisely the failure a
        header check cannot catch.
      */
      const head = readFileSync(path).subarray(0, 16);
      const isWebp = head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
      check(
        `Маскот: ${sheet} — настоящий WebP`,
        isWebp,
        isWebp ? "RIFF/WEBP" : "сигнатура не WebP",
      );
    }
  }

  check(
    "Маскот: пути к спрайтам совпадают с файлами на диске",
    widgetSource.includes("/mascots/cat-directions.webp") &&
      widgetSource.includes("/mascots/cat-reactions.webp"),
    "cat-directions.webp + cat-reactions.webp",
  );

  /* ---- degradation ---- */

  /*
    The one that matters. `Mascot` paints its sheets as a CSS background on a transparent
    button, so a missing file is invisible: no error, no box, just a focusable button
    sitting in the corner of every page. The probe is what stops that.
  */
  check(
    "Маскот: спрайт проверяется до появления кнопки",
    figureSource.includes("new Image()") && figureSource.includes("onerror"),
    "проба через Image + onerror",
  );
  check(
    "Маскот: кнопка не рисуется, пока спрайт не подтверждён",
    figureSource.includes('useState<"pending" | "ready" | "missing">("pending")') &&
      figureSource.includes('if (state !== "ready") return null'),
    "pending → ничего, ready → кот",
  );

  /* ---- accessibility and the tooltip ---- */

  check(
    "Маскот: у кнопки есть имя для скринридера",
    widgetSource.includes("label={MASCOT_LABEL}"),
    "label передаётся библиотеке",
  );
  check(
    "Маскот: подпись на русском",
    /const MASCOT_LABEL = "редакционный кот/.test(widgetSource),
    "«редакционный кот Ёжик»",
  );
  /*
   * The window is wide because the two halves sit in one long Tailwind string that is
   * wrapped across lines by the formatter — `aria-hidden` opens the element and
   * `group-hover:opacity-100` closes its class list. A narrow window would pass only for a
   * tooltip written on a single line, which is not the shape this file has.
   */
  check(
    "Маскот: тултип скрыт от скринридера",
    /aria-hidden[\s\S]{0,400}group-hover:opacity-100/.test(widgetSource),
    "aria-hidden + group-hover",
  );
  check(
    "Маскот: тултип не перехватывает указатель",
    occurrences(widgetSource, "pointer-events-none") >= 2,
    "у контейнера и у тултипа",
  );

  /* ---- where it is mounted ---- */

  check(
    "Маскот: подключён в публичном layout",
    layoutSource.includes("<MascotWidget />"),
    "<MascotWidget /> в (public)/layout.tsx",
  );

  /*
    Not in the root layout. The root layout wraps `/admin`, and a character that turns to
    follow the cursor is a moving target for someone trying to edit a headline.
  */
  const rootSource = readFileSync(
    new URL("../src/app/layout.tsx", import.meta.url),
    "utf8",
  );
  check(
    "Маскот: не в корневом layout — админка остаётся рабочей поверхностью",
    !rootSource.includes("Mascot"),
    "в app/layout.tsx упоминаний нет",
  );

  return checks;
}

const results = checkMascot();

for (const { name, ok, detail } of results) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = results.filter((result) => !result.ok);
console.log(
  `${results.length - failed.length}/${results.length} проверок пройдено`,
);

if (failed.length > 0) process.exit(1);

/** How many times a substring appears. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}