/**
 * Данные мачты: разбор курса ЦБ и погоды.
 *
 * Проверяется парсер, а не сеть: курс приходит с сайта Центробанка, погода — с open-meteo, и оба
 * ответа разбираются чистыми функциями (`parseCbrRates`, `weatherCondition`). Именно здесь
 * ломается доверие — если битый JSON вернёт «92,40» вместо «null», мачта покажет фальшь.
 */
import { parseCbrRates, weatherCondition } from "../src/lib/ticker";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

check(
  "Курс: валидный ответ ЦБ разбирается в числа",
  (() => {
    const rates = parseCbrRates({
      Valute: { USD: { Value: 92.4012 }, EUR: { Value: 100.15 } },
    });
    return rates !== null && rates.usd === 92.4012 && rates.eur === 100.15;
  })(),
  "usd + eur",
);

check(
  "Курс: битый JSON или пропавшая валюта — null, а не получисло",
  parseCbrRates(null) === null &&
    parseCbrRates({}) === null &&
    parseCbrRates({ Valute: { USD: { Value: 92.4 } } }) === null &&
    parseCbrRates({ Valute: { USD: { Value: "92.4" }, EUR: { Value: 100 } } }) === null &&
    parseCbrRates({ Valute: { USD: { Value: NaN }, EUR: { Value: 100 } } }) === null,
  "null на мусоре",
);

check(
  "Погода: код WMO переводится в русское слово",
  weatherCondition(0) === "ясно" &&
    weatherCondition(2) === "переменная облачность" &&
    weatherCondition(61) === "дождь" &&
    weatherCondition(71) === "снег" &&
    weatherCondition(95) === "гроза",
  "ясно / облачность / дождь / снег / гроза",
);

check(
  "Погода: неизвестный код даёт безопасное «облачно», а не undefined",
  typeof weatherCondition(999) === "string" && weatherCondition(999) === "облачно",
  weatherCondition(999),
);

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);
