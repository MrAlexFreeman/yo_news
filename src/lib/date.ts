/**
 * Date formatting for the public site. Kept in one place so every block of the
 * newspaper grid speaks the same Russian time format.
 *
 * All formatters are pinned to a timezone so the server, the client and the
 * static build agree — otherwise SSR and hydration disagree on "11:45".
 */
export const SITE_TIME_ZONE =
  process.env.NEXT_PUBLIC_SITE_TIMEZONE?.trim() || "Europe/Moscow";

/** "1 октября 2026, 14:30" — used in article headers. */
export const DATE_TIME_LONG = new Intl.DateTimeFormat("ru-RU", {
  timeZone: SITE_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "1 октября" — used on cards. */
export const DATE_SHORT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: SITE_TIME_ZONE,
  day: "numeric",
  month: "long",
});

/** "14:30" — the badge in the live news feed. */
export const TIME_ONLY = new Intl.DateTimeFormat("ru-RU", {
  timeZone: SITE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** "понедельник, 1 октября 2026" — the masthead dateline. */
export const DATELINE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: SITE_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Russian `Intl` appends " г." to years ("1 октября 2026 г."). Newspaper
 * datelines read better without it, so the suffix is stripped.
 */
function withoutYearSuffix(value: string): string {
  return value.replace(/\s*г\.$/, "");
}

export function formatDateTime(value: Date | null): string {
  return value ? withoutYearSuffix(DATE_TIME_LONG.format(value)) : "";
}

export function formatDate(value: Date | null): string {
  return value ? withoutYearSuffix(DATE_SHORT.format(value)) : "";
}

export function formatTime(value: Date | null): string {
  return value ? TIME_ONLY.format(value) : "";
}

export function formatDateline(now: Date): string {
  const text = withoutYearSuffix(DATELINE.format(now));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5 минут назад" for the live feed. Falls back to an absolute date beyond a
 * week, where relative wording stops helping the reader.
 */
export function formatRelative(value: Date, now: Date = new Date()): string {
  const diff = now.getTime() - value.getTime();

  if (diff < MINUTE) return "только что";
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  }

  return DATE_SHORT.format(value);
}

/** Russian plural rule: 1 товар, 2 товара, 5 товаров. */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
