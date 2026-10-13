/**
 * Реальные данные для мачты: курс ЦБ РФ и погода Екатеринбурга.
 *
 * Мачта раньше несла зашитые цифры — «USD/RUB 92,40», «EUR/RUB 100,15», «+16 °C». Для
 * новостного издания статичный курс, который не меняется и не соответствует бирже, — это
 * полуправда, подрывающая доверие сильнее, чем пустая строка. Поэтому цифры убраны и заменены
 * живым чтением: курс с официального сайта ЦБ, погода с бесплатного API open-meteo (без ключа).
 *
 * Оба чтения — «graceful»: любой отказ (сеть, таймаут, не-число в ответе) даёт `null`, и тикер
 * просто не печатает эту строку, а не падает и не показывает фальшь. `next: { revalidate }`
 * кэширует ответ: курс на 12 часов, погоду на час — мачта не ходит в сеть на каждый рендер,
 * что на VPS в 1 vCPU было бы расточительно.
 *
 * Парсеры вынесены в чистые функции (`parseCbrRates`, `weatherCondition`), чтобы набор проверок
 * мог прогнать их без сети.
 */

export type CbrRates = { usd: number; eur: number };
export type Weather = { temp: number; condition: string };

const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=56.8389&longitude=60.6057&current=temperature_2m,weather_code&timezone=Asia%2FYekaterinburg";

/** Курс доллара и евро из JSON Центробанка, либо null. */
export function parseCbrRates(json: unknown): CbrRates | null {
  const valute = (json as { Valute?: { USD?: { Value?: unknown }; EUR?: { Value?: unknown } } } | null)
    ?.Valute;
  const usd = valute?.USD?.Value;
  const eur = valute?.EUR?.Value;
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;
  if (typeof eur !== "number" || !Number.isFinite(eur)) return null;
  return { usd, eur };
}

/** Текущий курс ЦБ. Кэш 12 часов; null при любом отказе. */
export async function getCbrRates(): Promise<CbrRates | null> {
  try {
    const response = await fetch(CBR_URL, {
      next: { revalidate: 12 * 3600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return parseCbrRates(await response.json());
  } catch {
    return null;
  }
}

/** Русское название состояния по коду WMO, который отдаёт open-meteo. */
export function weatherCondition(code: unknown): string {
  switch (code) {
    case 0:
      return "ясно";
    case 1:
      return "малооблачно";
    case 2:
      return "переменная облачность";
    case 3:
      return "пасмурно";
    case 45:
    case 48:
      return "туман";
    case 51:
    case 53:
    case 55:
      return "морось";
    case 61:
    case 63:
    case 65:
      return "дождь";
    case 71:
    case 73:
    case 75:
    case 77:
      return "снег";
    case 80:
    case 81:
    case 82:
      return "ливень";
    case 95:
    case 96:
    case 99:
      return "гроза";
    default:
      return "облачно";
  }
}

/** Текущая погода Екатеринбурга. Кэш час; null при любом отказе. */
export async function getYekaterinburgWeather(): Promise<Weather | null> {
  try {
    const response = await fetch(WEATHER_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      current?: { temperature_2m?: unknown; weather_code?: unknown };
    };
    const temp = data?.current?.temperature_2m;
    if (typeof temp !== "number" || !Number.isFinite(temp)) return null;

    return { temp: Math.round(temp), condition: weatherCondition(data?.current?.weather_code) };
  } catch {
    return null;
  }
}
