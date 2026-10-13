/**
 * Сборка иконок сайта и приложения из одного исходника.
 *
 * Мастер — `Favicon_yo.png` в корне проекта. Скрипт один раз (и повторяемо) раскладывает его во
 * все места, где браузер и Android ожидают иконку: `favicon.ico`, `icon.png`, `apple-icon.png`,
 * иконки веб-манифеста и launcher-иконки Capacitor-обёртки. Правится мастер — перезапускается
 * скрипт, и ни одна площадка не остаётся со старой картинкой.
 *
 * Запуск: `npm run icons:build`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = "Favicon_yo.png";

/**
 * Все размеры, которые нужны вебу и Android.
 *
 * `icon.png` — 192, а не 512: браузер тянет его на каждый заход ради иконки вкладки, и полмегабайта
 * на это — расточительство. Крупная картинка (512) остаётся только в манифесте, откуда её берут
 * при установке приложения, а не при каждом просмотре страницы. Основную же иконку вкладки несут
 * кадры `favicon.ico` — они мелкие и уже все нужные размеры.
 */
const WEB_ICON = 192;
const APPLE_ICON = 180;
const FAVICON_SIZES = [16, 32, 48] as const;
const MANIFEST_SIZES = [192, 512] as const;

/** Плотности Android и соответствующие размеры launcher-иконки. */
const ANDROID_DENSITIES = [
  { dir: "mipmap-mdpi", legacy: 48, foreground: 108 },
  { dir: "mipmap-hdpi", legacy: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, foreground: 432 },
] as const;

/**
 * Доля кадра adaptive-иконки, которую занимает сама картинка.
 *
 * Android рисует adaptive-иконку на холсте 108dp и маскирует внешние 18dp с каждой стороны, то
 * есть безопасная зона — центральные 72dp. Картинка здесь занимает ~0.7 холста, чтобы целиком
 * попадать в неё при любой маске (круг, квадрат, squircle).
 */
const ADAPTIVE_FOREGROUND_RATIO = 0.7;

/** Сколько прозрачной рамки считать фоном, а не частью иконки. */
const TRIM_THRESHOLD = 12;

type Sharp = typeof import("sharp").default;

/**
 * Мастер, обрезанный по непрозрачной области и приведённый к квадрату.
 *
 * У исходника прозрачные поля по краям: без обрезки иконка заняла бы половину кадра и в 16px
 * выглядела бы точкой в пустоте.
 */
async function squareMaster(sharp: Sharp): Promise<Buffer> {
  const trimmed = await sharp(SOURCE)
    .trim({ threshold: TRIM_THRESHOLD })
    .resize(1024, 1024, { fit: "cover" })
    .png()
    .toBuffer();
  return trimmed;
}

/**
 * Один PNG заданного размера из мастера.
 *
 * Палитра, а не полный RGB: фотографическая иконка в 24-битном PNG весит сотни килобайт, а она
 * нужна лишь там, где размер картинки — от 16 до 512 пикселей. 256 цветов при `quality: 90` в
 * этих размерах неотличимы от полноцветной версии, но файл выходит в разы легче — а иконку
 * тянет каждый заход, в отличие от картинки в статье.
 */
async function png(sharp: Sharp, master: Buffer, size: number): Promise<Buffer> {
  return sharp(master)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
    .toBuffer();
}

/**
 * ICO-контейнер из PNG-кадров.
 *
 * Формат — 6 байт заголовка, по 16 байт на кадр, затем сами PNG. Кадры кладутся именно в PNG, а
 * не в BMP: так иконка с прозрачностью весит в разы меньше и её понимают все браузеры, которые
 * вообще запрашивают `favicon.ico`.
 */
function buildIco(frames: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length;

  frames.forEach((frame, index) => {
    const base = index * 16;
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, base);
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(frame.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += frame.data.length;
  });

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.data)]);
}

/**
 * Круглая версия иконки для `ic_launcher_round`.
 *
 * Легаси-иконки (до Android 8) launcher показывает как есть, без маски, поэтому «круглый» файл
 * обязан быть круглым сам — иначе на старом устройстве он сядет квадратом в круглый слот.
 * Маска вырезается SVG-кругом с `dest-in`: так остаётся исходная картинка внутри круга, а не
 * нарисованный поверх неё круг.
 */
async function round(sharp: Sharp, square: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(square)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
    .toBuffer();
}

/**
 * Средний цвет рамки иконки — фон для adaptive-иконки Android.
 *
 * Берётся по периметру обрезанного кадра, а не из угла: у иконки скруглённые прозрачные углы, и
 * цвет угла был бы прозрачным. Периметр даёт тот тёмно-синий, что и задумано фоном.
 */
async function edgeColor(sharp: Sharp, master: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(master).resize(64, 64).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const totals = { r: 0, g: 0, b: 0, count: 0 };

  const push = (x: number, y: number) => {
    const i = (y * info.width + x) * channels;
    if ((data[i + 3] ?? 0) < 200) return;
    totals.r += data[i] ?? 0;
    totals.g += data[i + 1] ?? 0;
    totals.b += data[i + 2] ?? 0;
    totals.count += 1;
  };

  const last = info.width - 2;
  for (let x = 2; x <= last; x += 1) {
    push(x, 2);
    push(x, info.height - 3);
  }
  for (let y = 2; y <= info.height - 3; y += 1) {
    push(2, y);
    push(info.width - 3, y);
  }

  if (totals.count === 0) return { r: 13, g: 32, b: 76 };
  return {
    r: Math.round(totals.r / totals.count),
    g: Math.round(totals.g / totals.count),
    b: Math.round(totals.b / totals.count),
  };
}

async function main() {
  const sharp = (await import("sharp")).default;
  const master = await squareMaster(sharp);

  // --- веб ---------------------------------------------------------------------

  const icoFrames = await Promise.all(
    FAVICON_SIZES.map(async (size) => ({ size, data: await png(sharp, master, size) })),
  );
  await writeFile("src/app/favicon.ico", buildIco(icoFrames));

  await writeFile("src/app/icon.png", await png(sharp, master, WEB_ICON));
  await writeFile("src/app/apple-icon.png", await png(sharp, master, APPLE_ICON));

  for (const size of MANIFEST_SIZES) {
    await writeFile(path.join("public/icons", `icon-${size}.png`), await png(sharp, master, size));
  }

  // --- Android -----------------------------------------------------------------

  const res = "android/app/src/main/res";
  for (const { dir, legacy, foreground } of ANDROID_DENSITIES) {
    await mkdir(path.join(res, dir), { recursive: true });

    await writeFile(path.join(res, dir, "ic_launcher.png"), await png(sharp, master, legacy));
    await writeFile(
      path.join(res, dir, "ic_launcher_round.png"),
      await round(sharp, await png(sharp, master, legacy), legacy),
    );

    // Adaptive-иконка: картинка уменьшена до безопасной зоны и центрирована на прозрачном холсте.
    const inner = Math.round(foreground * ADAPTIVE_FOREGROUND_RATIO);
    const foregroundPng = await sharp({
      create: {
        width: foreground,
        height: foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: await png(sharp, master, inner), gravity: "centre" }])
      .png()
      .toBuffer();
    await writeFile(path.join(res, dir, "ic_launcher_foreground.png"), foregroundPng);
  }

  const edge = await edgeColor(sharp, master);
  const hex = `#${[edge.r, edge.g, edge.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  await writeFile(
    path.join(res, "values/ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- Фон adaptive-иконки: средний цвет рамки исходной картинки. -->\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`,
  );

  const meta = await sharp(master).metadata();
  console.log(`мастер: ${meta.width}x${meta.height}`);
  console.log(`favicon.ico: ${FAVICON_SIZES.join("/")} px`);
  console.log(`icon.png ${WEB_ICON}, apple ${APPLE_ICON}, manifest ${MANIFEST_SIZES.join("/")}`);
  console.log(`android: ${ANDROID_DENSITIES.length} плотностей, фон ${hex}`);
}

void main();
