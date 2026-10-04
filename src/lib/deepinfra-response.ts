/**
 * Response parsing for DeepInfra's image endpoints.
 *
 * Kept free of credentials, `server-only` and `fetch` so it can be unit-tested
 * directly — this is the fragile half of cover generation. DeepInfra's
 * v1/inference API has shipped several envelopes for image models, and a parser
 * pinned to the wrong one fails silently: the editor waits ten seconds and gets
 * nothing, with no indication that a picture was actually returned.
 */

/** Below this a decoded buffer is not a photograph; guards against stray ids. */
const MIN_IMAGE_BYTES = 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";

/**
 * Identifies a raster image by its magic bytes.
 *
 * Necessary because base64 decoding is far too permissive: "x" is a valid base64
 * character, so a run of them decodes happily to a plausible number of bytes.
 * A size check alone therefore lets an error string or a request id through as
 * "the image", and the failure then surfaces much later as a confusing
 * "could not save" rather than "the provider sent no picture".
 */
export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  // PNG: \x89 P N G \r \n \x1a \n
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Decodes a base64 image payload, whether bare or wrapped in a data URL.
 * Returns null for anything that does not look like image data.
 */
function readBase64(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;

  const payload = value.startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;

  if (payload.length < 256) return null;

  const bytes = Buffer.from(payload, "base64");
  if (bytes.length < MIN_IMAGE_BYTES) return null;

  return detectImageFormat(bytes) ? bytes : null;
}

/**
 * Finds image bytes anywhere in a DeepInfra response.
 *
 * Checks the envelopes seen in the wild (`output`, `image`, `images`,
 * `inference`, `data`; bare strings; objects carrying `b64_json`) rather than
 * guessing one. Returns null when the payload holds no image, which the caller
 * turns into an editor-facing error naming what it looked for.
 */
export function extractImageBytes(payload: unknown): Buffer | null {
  if (typeof payload === "string") return readBase64(payload);
  if (!payload || typeof payload !== "object") return null;

  const body = payload as Record<string, unknown>;

  for (const key of ["output", "image", "images", "inference", "data"]) {
    const value = body[key];
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found =
          typeof entry === "object" && entry !== null
            ? readBase64(
                (entry as Record<string, unknown>).b64_json ??
                  (entry as Record<string, unknown>).image,
              )
            : readBase64(entry);
        if (found) return found;
      }
      continue;
    }

    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      const found = readBase64(nested.b64_json ?? nested.image ?? nested.output);
      if (found) return found;
      continue;
    }

    const found = readBase64(value);
    if (found) return found;
  }

  return null;
}