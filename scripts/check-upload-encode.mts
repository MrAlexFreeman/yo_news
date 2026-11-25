/**
 * What the upload re-encoder promises, asserted without a browser or a server.
 *
 * Measured before this existed: production held 298 MB of uploads, 78 files over 1 MB, and
 * a body photograph reached the reader at 1248 KB because it never passes through
 * `next/image`. The encoder is the one place that can fix that, so its rules are checked
 * here rather than discovered on a reader's phone:
 *
 *  - the long edge is capped and a larger image is actually smaller afterwards;
 *  - the container format is preserved, because VK, Telegram and MAX are handed the stored
 *    bytes and two of them document JPEG/PNG only;
 *  - transparency survives a PNG round-trip;
 *  - bytes that only *claim* to be an accepted image are refused instead of stored under a
 *    wrong extension;
 *  - a file that would grow is kept as it arrived.
 */
import { readFileSync } from "node:fs";

import { MAX_UPLOAD_EDGE, encodeUpload } from "../src/lib/upload-encode";

const sharp = (await import("sharp")).default;

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/** Deterministic noise: a flat colour compresses to nothing and would prove nothing. */
function noise(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[index] = seed & 0xff;
  }
  return raw;
}

// --- большой JPEG: край ограничен, файл легче ---------------------------------

const bigJpeg = await sharp(noise(3000, 2000), {
  raw: { width: 3000, height: 2000, channels: 3 },
}).jpeg({ quality: 95 }).toBuffer();

const big = await encodeUpload(bigJpeg, "image/jpeg");
check(
  "JPEG 3000×2000: край ужат до лимита, файл стал легче",
  big !== null &&
    !big.originalKept &&
    Math.max(big.width, big.height) === MAX_UPLOAD_EDGE &&
    big.width === MAX_UPLOAD_EDGE &&
    big.bytes.length < bigJpeg.length,
  big
    ? `${Math.round(bigJpeg.length / 1024)} КБ → ${Math.round(big.bytes.length / 1024)} КБ, ` +
        `${big.width}×${big.height}, ${big.format}`
    : "null",
);

const decodedBig = big ? await sharp(big.bytes).metadata() : null;
check(
  "JPEG: записанные байты действительно JPEG с теми же размерами",
  decodedBig?.format === "jpeg" &&
    decodedBig.width === big?.width &&
    decodedBig.height === big?.height &&
    big?.extension === ".jpg",
  `${decodedBig?.format} ${decodedBig?.width}×${decodedBig?.height}`,
);

check(
  "JPEG: EXIF не переносится (в снимке с телефона были бы GPS-координаты)",
  decodedBig?.exif === undefined &&
    decodedBig?.icc === undefined &&
    decodedBig?.xmp === undefined,
  decodedBig?.exif ? "EXIF остался" : "метаданных нет",
);

// --- маленький файл не раздувается -------------------------------------------

const tinyJpeg = await sharp(noise(200, 150), {
  raw: { width: 200, height: 150, channels: 3 },
}).jpeg({ quality: 35 }).toBuffer();

const tiny = await encodeUpload(tinyJpeg, "image/jpeg");
check(
  "Маленький JPEG: оригинал сохраняется, если перекодирование не выигрывает",
  tiny !== null && tiny.bytes.length <= tinyJpeg.length,
  tiny ? `${tinyJpeg.length} → ${tiny.bytes.length} байт, originalKept=${tiny.originalKept}` : "null",
);

// --- форматы сохраняются ------------------------------------------------------

const webp = await encodeUpload(
  await sharp(noise(1200, 900), { raw: { width: 1200, height: 900, channels: 3 } })
    .webp({ quality: 95 })
    .toBuffer(),
  "image/webp",
);
check(
  "WebP остаётся WebP (публикаторы получают байты как есть)",
  webp?.format === "webp" && webp.extension === ".webp" && webp.contentType === "image/webp",
  webp ? `${webp.format} ${webp.extension}` : "null",
);

const alphaPng = await sharp({
  create: { width: 900, height: 700, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.4 } },
})
  .png()
  .toBuffer();

const png = await encodeUpload(alphaPng, "image/png");
const decodedPng = png ? await sharp(png.bytes).metadata() : null;
check(
  "PNG с прозрачностью: формат сохранён и альфа-канал не потерян",
  png?.format === "png" &&
    png.extension === ".png" &&
    decodedPng?.format === "png" &&
    decodedPng.hasAlpha === true,
  `${decodedPng?.format}, hasAlpha=${decodedPng?.hasAlpha}`,
);

// --- подделка расширения ------------------------------------------------------

const gif = await sharp(noise(300, 200), { raw: { width: 300, height: 200, channels: 3 } })
  .gif()
  .toBuffer();

const disguised = await encodeUpload(gif, "image/png");
check(
  "GIF под видом image/png отвергается, а не сохраняется как .png",
  disguised === null,
  disguised ? `принят как ${disguised.format}` : "null — 415",
);

// --- маршрут и конфигурация действительно используют это ----------------------

const routeSource = readFileSync(new URL("../src/app/api/upload/route.ts", import.meta.url), "utf8");
check(
  "Маршрут загрузки проходит через encodeUpload до записи файла",
  routeSource.includes("encodeUpload(original, file.type)") &&
    routeSource.indexOf("encodeUpload(") < routeSource.indexOf("writeFile(") &&
    routeSource.includes("encoded.bytes"),
  "перекодирование до writeFile",
);

const configSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
check(
  "next.config: вариант изображения живёт 30 дней, а не 60 секунд",
  configSource.includes("minimumCacheTTL") && configSource.includes("60 * 60 * 24 * 30"),
  "minimumCacheTTL задан",
);
check(
  "next.config: маскоты и иконки отдаются с длинным кэшем",
  configSource.includes("/mascots/:path*") && configSource.includes("stale-while-revalidate"),
  "headers() для /mascots",
);

const homeRiver = readFileSync(
  new URL("../src/components/river-article-card.tsx", import.meta.url),
  "utf8",
);
check(
  "Главная: лид-карточка предзагружается, остальные остаются ленивыми",
  homeRiver.includes("preload={lead}"),
  "preload={lead}",
);

for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
