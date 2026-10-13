import "server-only";

import { access, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCoverImage } from "@/lib/cover-image";
import { resolveUploadPath, UPLOAD_DIR, UPLOAD_URL_PREFIX } from "@/lib/upload-dir";

/**
 * Обложка статьи в формате, который Дзен действительно принимает.
 *
 * Спецификация: «Для изображений выбирайте файлы в формате JPEG, GIF или PNG», и дальше —
 * «если изображение пришло в некорректном формате, материал будет опубликован без картинки».
 *
 * Замер по боевой базе 13 октября: из материалов за неделю в ленту уходило 14 JPEG, 6 WebP и
 * 1 PNG, то есть **две трети карточек выходили бы без изображения**. Виной тому не лента, а
 * загрузка: `/api/upload` и генератор обложек перекодируют всё в WebP, потому что браузеру так
 * легче, а площадка такой формат не берёт.
 *
 * Что здесь происходит: обложка в допустимом формате возвращается как есть, всё прочее
 * перекодируется в JPEG 1200×675 один раз и кладётся рядом с оригиналом под именем
 * `<stem>.dzen.jpg`. Второй запрос уже ничего не делает — файл проверяется до конвертации.
 * Конвертация на каждом запросе ленты стоила бы на этом VPS слишком дорого: это чтение,
 * декодирование и запись картинки на каждый из 13 материалов при публикации каждые пять минут.
 */
const ACCEPTED_BY_DZEN = /\.(?:jpe?g|png|gif)$/i;

/** Размер кадра обложки: 16:9 и не меньше 700 пикселей по ширине, как требует спецификация. */
export const DZEN_COVER_WIDTH = 1200;
export const DZEN_COVER_HEIGHT = 675;

/** Суффикс JPEG-версии, по которому узнаётся, что конвертация уже сделана. */
const SUFFIX = ".dzen.jpg";

/** True when Dzen will fetch and render this file as it is. */
export function isDzenCoverReady(coverImage: string): boolean {
  return ACCEPTED_BY_DZEN.test(coverImage.split("?")[0].split("#")[0]);
}

/**
 * The URL to put in `<enclosure>`, or null when the cover cannot be turned into one.
 *
 * `base` is the site's absolute address: the fallback lives next to the original, so the
 * answer is a site-relative path made absolute here.
 */
export async function dzenCoverUrl(
  coverImage: string | null,
  base: string,
): Promise<string | null> {
  const trimmed = coverImage?.trim();
  if (!trimmed) return null;

  const bare = trimmed.split("?")[0].split("#")[0];
  if (isDzenCoverReady(bare)) return absolute(bare, base);

  /*
    Только то, что лежит в каталоге загрузок.

    Локальный файл можно перекодировать; удалённый адрес потребовал бы сети на каждый запрос
    ленты, а кешировать его негде — кроме как тем же файлом. Всё, что не `/uploads/...`,
    отдаётся как есть: на боевой базе таких обложек нет, все загруженные и сгенерированные
    лежат на диске.
  */
  if (!bare.startsWith(UPLOAD_URL_PREFIX)) return absolute(bare, base);

  const target = resolveUploadPath(`${bare.slice(UPLOAD_URL_PREFIX.length).replace(/\.webp$/i, "")}${SUFFIX}`);
  if (!target) return absolute(bare, base);

  if (await exists(target)) {
    return `${base}${UPLOAD_URL_PREFIX}${path.basename(target)}`;
  }

  try {
    const { bytes } = await readCoverImage(trimmed);
    const { default: sharp } = await import("sharp");

    const jpeg = await sharp(Buffer.from(bytes))
      .resize({
        width: DZEN_COVER_WIDTH,
        height: DZEN_COVER_HEIGHT,
        fit: "cover",
        position: "attention",
        withoutEnlargement: false,
      })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    await writeFile(target, jpeg);
    console.log(
      `[dzen] обложка перекодирована в JPEG: ${path.basename(bare)} → ${path.basename(target)}`,
    );
    return `${base}${UPLOAD_URL_PREFIX}${path.basename(target)}`;
  } catch (error) {
    /*
      Не роняем ленту из-за одной картинки.

      Лучше отдать обложку как есть — она уже на месте, и Дзен разберётся — чем оставить
      материал без `<enclosure>`. Причина пишется в лог: молча пропавший кадр не виден.
    */
    console.warn(
      `[dzen] не удалось перекодировать обложку ${bare}: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
      }`,
    );
    return absolute(bare, base);
  }
}

/**
 * Картинка из тела материала в формате, который Дзен берёт.
 *
 * Отличие от обложки — одна строка: пропорции сохраняются, а не подгоняются под 16:9.
 * Обложка это кадр, который можно обрезать; иллюстрация внутри статьи — нет, и обрезка
 * исказила бы её. Замер по боевой базе 13 октября: в ленте оставались две картинки WebP из
 * тела материалов — подписи на английском («man holding red light flare inside cave»),
 * то есть сгенерированные обложки, вставленные редактором в текст.
 *
 * Ширина ограничена той же тысячей двухсот пикселей: Дзен просит не меньше 700, а файл
 * вдвое большего размера грузит площадку без всякой пользы.
 */
export async function dzenBodyImageUrl(
  source: string | null,
  base: string,
): Promise<string | null> {
  const trimmed = source?.trim();
  if (!trimmed) return null;

  const bare = trimmed.split("?")[0].split("#")[0];
  if (isDzenCoverReady(bare)) return absolute(bare, base);
  if (!bare.startsWith(UPLOAD_URL_PREFIX)) return absolute(bare, base);

  const target = resolveUploadPath(
    `${bare.slice(UPLOAD_URL_PREFIX.length).replace(/\.webp$/i, "")}${SUFFIX}`,
  );
  if (!target) return absolute(bare, base);

  if (await exists(target)) return `${base}${UPLOAD_URL_PREFIX}${path.basename(target)}`;

  try {
    const { bytes } = await readCoverImage(trimmed);
    const { default: sharp } = await import("sharp");

    const jpeg = await sharp(Buffer.from(bytes))
      .resize({ width: DZEN_COVER_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    await writeFile(target, jpeg);
    console.log(
      `[dzen] картинка из текста перекодирована в JPEG: ${path.basename(bare)} → ${path.basename(target)}`,
    );
    return `${base}${UPLOAD_URL_PREFIX}${path.basename(target)}`;
  } catch (error) {
    console.warn(
      `[dzen] не удалось перекодировать картинку ${bare}: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
      }`,
    );
    return absolute(bare, base);
  }
}

function absolute(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Куда физически ложится JPEG-версия — для проверок и для уборки. */
export function dzenCoverPath(coverImage: string): string | null {
  const bare = coverImage.split("?")[0].split("#")[0];
  if (!bare.startsWith(UPLOAD_URL_PREFIX)) return null;
  return resolveUploadPath(
    `${bare.slice(UPLOAD_URL_PREFIX.length).replace(/\.webp$/i, "")}${SUFFIX}`,
  );
}

/** Каталог, в котором живут перекодированные обложки. */
export const DZEN_COVER_DIR = UPLOAD_DIR;