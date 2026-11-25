/**
 * Re-encoding an uploaded photograph before it is written to disk.
 *
 * **Why this exists, measured on production on 2026-11-25.** The upload endpoint stored
 * the bytes exactly as the browser sent them. The `uploads/` directory held 445 files,
 * 298 MB in total, 190 of them over 300 KB and 78 over 1 MB — the largest a 6.8 MB PNG.
 * A story's photograph is rendered as a plain `<img>` inside the article body, so those
 * bytes reached the reader unmodified: one article carried 1.2 MB, 769 KB and 624 KB
 * JPEGs, and the browser downloaded all of it.
 *
 * The image optimiser behind `next/image` does shrink covers and card thumbnails, but a
 * body photograph never passes through it — the editor writes `<img src="/uploads/…">`
 * straight into the article HTML. Re-encoding at the upload gate is the only place where
 * every image is seen exactly once, in a request that already has a server and a
 * deadline, instead of on the reader's phone.
 *
 * **What it does.** Applies the EXIF orientation so "sideways photo" stops being a
 * property of the metadata, strips the rest of the metadata (a phone photo carries GPS
 * coordinates the editorial office never meant to publish), caps the longest edge at
 * `MAX_UPLOAD_EDGE`, and re-encodes in the *same* container format.
 *
 * **Why the format is kept.** JPEG stays JPEG, PNG stays PNG, WebP stays WebP, even
 * though WebP would be smaller still. Three publishers read the stored file directly and
 * hand its bytes to somebody else: VK's photo upload, Telegram's `sendPhoto` and MAX's
 * attachment upload. Two of those document JPEG/PNG only, and a cover that fails to
 * attach is a post without a picture — a much worse outcome than a few hundred kilobytes.
 * Delivery to a browser is already WebP: `next/image` converts on the way out. So the
 * format is not chosen here; it is preserved, and only the weight changes.
 *
 * **Never blocks an upload.** `sharp` is an optional dependency of Next rather than this
 * project's own, so it can legitimately be absent. If it is missing or refuses the file,
 * the original bytes are stored unchanged. A photograph that is too heavy is a problem;
 * an upload that fails is an outage.
 */

/**
 * Longest edge kept, in pixels.
 *
 * Measured on the heaviest files production actually had on 2026-11-25 (a 1248 KB
 * 2000×1877 JPEG and a 5760 KB 4000×3000 one): 1600 px at quality 80 with mozjpeg took
 * them to 435 KB and 587 KB. 1600 is 2× the widest place a photograph is painted — the
 * ~800 px article column and the 790 px river card — so it stays sharp on a retina screen
 * without shipping a 4000 px camera original.
 */
export const MAX_UPLOAD_EDGE = 1600;

/** JPEG/WebP quality. 80 is where a news photograph stops showing artefacts at 100%. */
export const UPLOAD_QUALITY = 80;

/**
 * The formats the endpoint accepts, keyed by what `sharp` reports for the *bytes*.
 *
 * Read from the file, not from the declared MIME: `image/png` on a GIF is a thing a
 * crafted request can say, and the stored file must be what its extension claims.
 */
const FORMATS = {
  jpeg: { extension: ".jpg", contentType: "image/jpeg" },
  png: { extension: ".png", contentType: "image/png" },
  webp: { extension: ".webp", contentType: "image/webp" },
} as const;

export type UploadFormat = keyof typeof FORMATS;

export type EncodedUpload = {
  /** What to write to disk. */
  bytes: Buffer;
  format: UploadFormat;
  /** Extension and type for the stored file — derived from the bytes, not the request. */
  extension: string;
  contentType: string;
  width: number;
  height: number;
  /** True when the original bytes were kept because re-encoding would not have helped. */
  originalKept: boolean;
};

/** Lazily imported so a host without `sharp` can still serve and receive files. */
async function loadSharp(): Promise<typeof import("sharp").default | null> {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

/**
 * The size a browser paints, which is the stored one unless EXIF says "rotate".
 *
 * Orientation 5–8 swaps the axes. Kept only for the `originalKept` branch: when the file
 * is re-encoded the rotation is baked into the pixels and `sharp` reports the result.
 */
function displayedSize(meta: {
  width?: number;
  height?: number;
  orientation?: number;
}): { width: number; height: number } {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const swapped = typeof meta.orientation === "number" && meta.orientation >= 5;
  return swapped ? { width: height, height: width } : { width, height };
}

/** What the caller gets when `sharp` is unavailable: the file as it arrived. */
function keepOriginal(
  bytes: Buffer,
  format: UploadFormat,
  size: { width: number; height: number } = { width: 0, height: 0 },
): EncodedUpload {
  return {
    bytes,
    format,
    extension: FORMATS[format].extension,
    contentType: FORMATS[format].contentType,
    width: size.width,
    height: size.height,
    originalKept: true,
  };
}

/**
 * Re-encodes one upload.
 *
 * Returns `null` when the bytes are not one of the three accepted formats — including the
 * case where they merely claim to be. The caller answers 415, which is the correct answer
 * to a GIF wearing a PNG's header.
 */
export async function encodeUpload(
  bytes: Buffer,
  declaredMime: string,
): Promise<EncodedUpload | null> {
  const sharp = await loadSharp();

  if (!sharp) {
    const fallback = Object.entries(FORMATS).find(
      ([, entry]) => entry.contentType === declaredMime.split(";")[0]?.trim().toLowerCase(),
    )?.[0] as UploadFormat | undefined;
    console.warn("[upload] sharp недоступен — файл сохранён без перекодирования");
    return fallback ? keepOriginal(bytes, fallback) : null;
  }

  let meta: { width?: number; height?: number; orientation?: number; format?: string };
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    return null;
  }

  const format = meta.format as UploadFormat | undefined;
  if (!format || !(format in FORMATS)) return null;

  /*
    `rotate()` with no argument applies the EXIF orientation. Without it a portrait phone
    photo keeps its sideways pixels and a flag, and every re-encode afterwards has to
    remember the flag.

    `resize(… fit: "inside", withoutEnlargement: true)` shrinks the long edge only; a
    small image is never blown up just to reach the cap.
  */
  const pipeline = sharp(bytes)
    .rotate()
    .resize({
      width: MAX_UPLOAD_EDGE,
      height: MAX_UPLOAD_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });

  /*
    `sharp` drops EXIF, ICC and XMP unless asked to keep them, which is what we want: GPS
    coordinates from a phone camera are personal data, and an editor's camera model is not
    part of a news photograph.

    `mozjpeg` costs about half a second of CPU on the deployment's single core and returns
    roughly 20% of the bytes at the same quality — measured on those two files, 667 KB
    became 555 KB at edge 1920. An upload happens a few times a day and a reader's download
    happens thousands of times, so the trade is the right way round.
  */
  const encoder =
    format === "jpeg"
      ? pipeline.jpeg({ quality: UPLOAD_QUALITY, mozjpeg: true, progressive: true })
      : format === "webp"
        ? pipeline.webp({ quality: UPLOAD_QUALITY, effort: 4 })
        : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 7 });

  let encoded: { data: Buffer; info: { width: number; height: number } };
  try {
    encoded = await encoder.toBuffer({ resolveWithObject: true });
  } catch (error) {
    console.warn("[upload] перекодирование не удалось — файл сохранён как есть", error);
    return keepOriginal(bytes, format, displayedSize(meta));
  }

  /*
    A small, already-compressed file can grow: re-encoding a 60 KB thumbnail at quality 82
    adds bytes for no visible gain. Keeping the smaller of the two is the whole rule, and
    it needs no threshold to be right.
  */
  if (encoded.data.length >= bytes.length) {
    return keepOriginal(bytes, format, displayedSize(meta));
  }

  return {
    bytes: encoded.data,
    format,
    extension: FORMATS[format].extension,
    contentType: FORMATS[format].contentType,
    width: encoded.info.width,
    height: encoded.info.height,
    originalKept: false,
  };
}
