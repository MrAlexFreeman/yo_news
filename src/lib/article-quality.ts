/**
 * Оценка качества материала для чек-листа в редакторе.
 *
 * Чистые функции: ни DOM, ни Prisma, ни React. Причина та же, что у `messenger-post.ts`:
 * правила «заголовок 40–120» и «стена текста» — это то, что редактор видит как совет, а
 * проверяющий как утверждение, и проверять их на живом редакторе нельзя — там нет ни одного
 * способа сказать, почему индикатор жёлтый.
 *
 * Ничего не запрещает: все уровни, включая «плохо», — это подсказка. Редактор решает сам, а
 * публикации ничто из этого не блокирует.
 */

/** Насколько всё хорошо: цвет индикатора и повод для совета. */
export type QualityLevel = "good" | "warn" | "bad";

export type QualityCheck = {
  id: "title" | "lead" | "structure" | "credit";
  /** Что проверяется — строка для чек-листа. */
  label: string;
  level: QualityLevel;
  /** Факт: длина, число абзацев, состояние источника. Без оценок. */
  detail: string;
  /** Совет, который показывается только когда он есть. */
  hint?: string;
};

/** Заголовок: 40–120 символов — рабочий диапазон. */
export const TITLE_GOOD_MIN = 40;
export const TITLE_GOOD_MAX = 120;
/** За его пределами заголовок ещё читается, но уже вредит — отсюда «жёлтый». */
export const TITLE_WARN_MIN = 20;
export const TITLE_WARN_MAX = 160;

/** Лид-вводка: 120–280 символов — это 2–4 строки быстрого чтения. */
export const LEAD_GOOD_MIN = 120;
export const LEAD_GOOD_MAX = 280;
export const LEAD_WARN_MIN = 80;
export const LEAD_WARN_MAX = 360;

/** Сколько абзацев подряд и сколько знаков в них считаются «стеной текста». */
export const WALL_PARAGRAPHS = 3;
export const WALL_CHARS = 900;

export const WALL_HINT = "💡 Добавьте подзаголовок H2 или врезку, чтобы удержать читателя.";

/** Длина как её видит редактор: символы, без крайних пробелов. */
function length(value: string | null | undefined): number {
  return (value ?? "").trim().length;
}

function titleCheck(title: string | null | undefined): QualityCheck {
  const size = length(title);

  if (size === 0) {
    return { id: "title", label: "Заголовок", level: "bad", detail: "не заполнен", hint: "Без заголовка материал не опубликуется." };
  }
  if (size >= TITLE_GOOD_MIN && size <= TITLE_GOOD_MAX) {
    return { id: "title", label: "Заголовок", level: "good", detail: `${size} символов — в рабочем диапазоне 40–120` };
  }

  const short = size < TITLE_GOOD_MIN;
  const hard = size < TITLE_WARN_MIN || size > TITLE_WARN_MAX;

  return {
    id: "title",
    label: "Заголовок",
    level: hard ? "bad" : "warn",
    detail: `${size} символов при рабочем диапазоне 40–120`,
    hint: short
      ? "Коротко: читатель в ленте не поймёт, о чём материал. Добавьте, что именно случилось и где."
      : "Длинно: в ленте и в сниппете поиска такой заголовок обрежется.",
  };
}

function leadCheck(lead: string | null | undefined): QualityCheck {
  const size = length(lead);

  if (size === 0) {
    return {
      id: "lead",
      label: "Лид («Главное за 30 сек»)",
      level: "bad",
      detail: "не заполнен",
      hint: "Лид — то, что читатель видит до первого абзаца. Одно-два предложения: что произошло и почему это важно.",
    };
  }
  if (size >= LEAD_GOOD_MIN && size <= LEAD_GOOD_MAX) {
    return { id: "lead", label: "Лид («Главное за 30 сек»)", level: "good", detail: `${size} символов — в диапазоне 120–280` };
  }

  const short = size < LEAD_GOOD_MIN;
  const hard = size < LEAD_WARN_MIN || size > LEAD_WARN_MAX;

  return {
    id: "lead",
    label: "Лид («Главное за 30 сек»)",
    level: hard ? "bad" : "warn",
    detail: `${size} символов при диапазоне 120–280`,
    hint: short
      ? "Коротко для вводки: добавьте второе предложение — что это значит для читателя."
      : "Длинно: вводка превращается во второй первый абзац. Оставьте главное, детали — в текст.",
  };
}

/**
 * Теги, которые рвут «стену»: подзаголовок, цитата, картинка, список, таблица, разделитель и
 * любой блок (`div` — это наши спецврезки и фигуры).
 *
 * Токен один на всё, поэтому поиск идёт за один проход: `<p>…</p>` приходит с содержимым во
 * второй группе, любой из перечисленных тегов — без него.
 */
const TOKEN = /<(?:h[1-6]|blockquote|figure|img|ul|ol|table|pre|div|hr)\b[^>]*>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;

const TAGS = /<[^>]*>/g;

/** Текст абзаца без разметки — для подсчёта знаков. */
function plain(html: string): string {
  return html.replace(TAGS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Самая длинная «стена»: сколько абзацев подряд и сколько в них знаков.
 *
 * Эвристика, и это записано честно: абзацы внутри цитаты тоже считаются абзацами, потому что
 * отдельного разбора дерева здесь нет. Цитата при этом сама рвёт стену открывающим тегом, так что
 * ложное срабатывание возможно только на цитате из четырёх длинных абзацев — а такая цитата и
 * правда стена.
 */
export function longestWall(html: string | null | undefined): { paragraphs: number; chars: number } {
  let best = { paragraphs: 0, chars: 0 };
  let run = { paragraphs: 0, chars: 0 };

  const flush = () => {
    if (run.paragraphs > best.paragraphs || (run.paragraphs === best.paragraphs && run.chars > best.chars)) {
      best = { ...run };
    }
    run = { paragraphs: 0, chars: 0 };
  };

  for (const match of (html ?? "").matchAll(TOKEN)) {
    if (match[1] !== undefined) {
      run.paragraphs += 1;
      run.chars += plain(match[1]).length;
      continue;
    }
    // Содержимое второй группы не пришло — значит это разрыв, а не абзац.
    flush();
  }
  flush();

  return best;
}

function structureCheck(contentHtml: string | null | undefined): QualityCheck {
  const wall = longestWall(contentHtml);

  if (wall.paragraphs > WALL_PARAGRAPHS && wall.chars > WALL_CHARS) {
    return {
      id: "structure",
      label: "Читаемость",
      level: "warn",
      detail: `${wall.paragraphs} ${plural(wall.paragraphs, "абзац", "абзаца", "абзацев")} подряд, ${wall.chars} ${plural(wall.chars, "знак", "знака", "знаков")} без подзаголовка, цитаты или фото`,
      hint: WALL_HINT,
    };
  }

  if (wall.paragraphs === 0 && plain(contentHtml ?? "").length === 0) {
    return {
      id: "structure",
      label: "Читаемость",
      level: "bad",
      detail: "текста ещё нет",
      hint: "Материал без текста опубликовать нельзя.",
    };
  }

  return {
    id: "structure",
    label: "Читаемость",
    level: "good",
    detail: `Самая длинная непрерывная часть — ${wall.paragraphs} ${plural(wall.paragraphs, "абзац", "абзаца", "абзацев")}, ${wall.chars} ${plural(wall.chars, "знак", "знака", "знаков")}`,
  };
}

function creditCheck(
  coverImage: string | null | undefined,
  photoSource: string | null | undefined,
): QualityCheck {
  const cover = (coverImage ?? "").trim();
  const source = (photoSource ?? "").trim();

  if (!cover) {
    return {
      id: "credit",
      label: "Изображения и источники",
      level: "warn",
      detail: "обложки нет",
      hint: "Материал без обложки хуже открывается в лентах и соцсетях.",
    };
  }

  if (!source) {
    return {
      id: "credit",
      label: "Изображения и источники",
      level: "warn",
      detail: "обложка выбрана, источник не указан",
      hint: "Укажите источник фото — поле «Источник» под обложкой. Чужой снимок без подписи — это претензия, а не мелочь.",
    };
  }

  return { id: "credit", label: "Изображения и источники", level: "good", detail: `источник указан: ${source.slice(0, 60)}` };
}

export type QualityInput = {
  title?: string | null;
  lead?: string | null;
  contentHtml?: string | null;
  coverImage?: string | null;
  photoSource?: string | null;
};

/** Все проверки по порядку — так, как они показываются в чек-листе. */
export function articleQuality(input: QualityInput): QualityCheck[] {
  return [
    titleCheck(input.title),
    leadCheck(input.lead),
    structureCheck(input.contentHtml),
    creditCheck(input.coverImage, input.photoSource),
  ];
}

/** Сводка для свёрнутой строки: сколько замечаний и что именно не в порядке. */
export function qualitySummary(checks: QualityCheck[]): {
  level: QualityLevel;
  text: string;
} {
  const bad = checks.filter((check) => check.level === "bad").length;
  const warn = checks.filter((check) => check.level === "warn").length;

  if (bad > 0) return { level: "bad", text: `${bad} ${plural(bad, "замечание", "замечания", "замечаний")} требуют правки` };
  if (warn > 0) return { level: "warn", text: `${warn} ${plural(warn, "подсказка", "подсказки", "подсказок")}` };
  return { level: "good", text: "всё в порядке" };
}

/** Русское склонение: 1 замечание, 2 замечания, 5 замечаний. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
