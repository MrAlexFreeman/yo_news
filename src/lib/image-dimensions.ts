/**
 * Reads a picked image's intrinsic pixel size in the browser.
 *
 * Two places need this and neither can get it cheaply on the server: the cover
 * warning before upload, and the gallery entries, whose dimensions the RSS feed
 * uses to drop anything below Dzen's minimum. Parsing a JPEG or PNG header on
 * every feed build would be a lot of machinery for a number the browser already
 * had in hand when the file was chosen.
 */

/** Dzen's documented minimum width for the image on a material's card. */
export const DZEN_MIN_CARD_WIDTH = 700;

/** The exact wording editors are warned with about a narrow cover. */
export const NARROW_COVER_WARNING =
  `Ширина обложки меньше ${DZEN_MIN_CARD_WIDTH} px — Дзен может не создать большую карточку материала`;

/**
 * `createImageBitmap` is the cheap path and covers the formats the upload
 * endpoint accepts; the `Image()` fallback handles older Safari. Both are
 * decode-only, so a large photo costs a few milliseconds and nothing is
 * uploaded. Never rejects: an undecodable file reports zeroes and the caller
 * decides whether that matters.
 */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return createImageBitmap(file)
    .then((bitmap) => {
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    })
    .catch(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          const url = URL.createObjectURL(file);
          const probe = new window.Image();
          probe.onload = () => {
            resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
            URL.revokeObjectURL(url);
          };
          probe.onerror = () => {
            resolve({ width: 0, height: 0 });
            URL.revokeObjectURL(url);
          };
          probe.src = url;
        }),
    );
}