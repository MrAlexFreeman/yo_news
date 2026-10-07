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

/**
 * A stable key for the calendar day a moment falls on, in the site's timezone.
 *
 * `Intl.DateTimeFormat` with the full date is used rather than slicing the ISO string,
 * because the ISO string is in UTC and the day boundary is not: 23:30 in Moscow is the
 * previous day in UTC, and slicing would file it under the wrong heading.
 */
function dayKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/**
 * Splits a newest-first list into day groups for the live feed.
 *
 * Why this exists: the feed's badge is a bare clock time, so a list running past
 * midnight reads as out of order. "11:12" followed by "17:28" looks scrambled until
 * you notice the first belongs to one day and the second to the day before. Naming
 * the day between the groups removes the puzzle without touching the sort, which is
 * already correct.
 *
 * `now` is passed in rather than read from the clock so a statically rendered page
 * keeps the headings it was built with.
 */
export type DayGroup<T> = { key: string; label: string; items: T[] };

/** "Сегодня", "Вчера", or the date — what a group heading says. */
export function dayLabel(value: Date, now: Date): string {
  const today = dayKey(value) === dayKey(now);
  if (today) return "Сегодня";

  const yesterday = new Date(now.getTime() - DAY);
  if (dayKey(value) === dayKey(yesterday)) return "Вчера";

  return withoutYearSuffix(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: SITE_TIME_ZONE,
      day: "numeric",
      month: "long",
    }).format(value),
  );
}

/**
 * Groups `items` by calendar day, preserving their order inside each group.
 *
 * Expects newest first, which is what the feed query returns; groups come out in the
 * order their first item appears, so no re-sorting happens here.
 */
export function groupByDay<T>(
  items: readonly T[],
  at: (item: T) => Date,
  now: Date,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];

  for (const item of items) {
    const value = at(item);
    const key = dayKey(value);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: dayLabel(value, now), items: [item] });
    }
  }

  return groups;
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
