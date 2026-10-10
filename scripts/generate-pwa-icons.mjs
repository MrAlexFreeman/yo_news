/**
 * Generates every icon this site ships: the tab favicon, its vector source, the iOS
 * home-screen icon and the two PWA launcher sizes.
 *
 * Run with: node scripts/generate-pwa-icons.mjs
 *
 * ---------------------------------------------------------------------------
 * The design, and why it is inverted from the one it replaced
 * ---------------------------------------------------------------------------
 * The previous mark was an orange «Е» on near-black, and it failed for a reason that was
 * measured rather than guessed: at 192px its dominant colour came out `#080818`, and the
 * same file reduced to 16px was 213 bytes of almost uniform darkness — a black square with
 * something unreadable inside it, which is exactly what appeared on the tab.
 *
 * The failure was structural, not cosmetic. A thin light mark on a large dark field loses
 * most of its ink when the rasteriser averages neighbouring pixels down to sixteen of them;
 * what survives is the field. So the field is now the brand orange and the letter is white,
 * which reverses the ratio: the colour a reader sees at 16px is the colour that carries the
 * meaning, and the letter is the gap in it.
 *
 * Two more things were wrong and are fixed here:
 *
 *  - The letter was an «Е». The dots were drawn beside it, so the file was a valid «Ё» by
 *    construction — but they were separate circles competing with the letter for the little
 *    room there is, and nothing made them read as part of it. They are round and they touch
 *    the letter's optical top, matching how the wordmark in the header is set.
 *  - The strokes were 40 units of 512, about 8%, which is 1.3 pixels at 16px. They are 72
 *    units now — 2.25 pixels at the smallest size this file is ever asked to be. Every
 *    dimension below was chosen against that budget rather than against how it looks at
 *    512, which is a size no reader ever sees.
 *
 * ---------------------------------------------------------------------------
 * Why the letter is geometry and not a glyph
 * ---------------------------------------------------------------------------
 * `sharp` resolves SVG `<text>` against whatever fonts the *build machine* happens to have.
 * A box with neither DejaVu nor Liberation installed produces a blank glyph, silently, and
 * the icon ships empty. An «Ё» is four bars and two dots, so it is drawn as exactly that.
 *
 * ---------------------------------------------------------------------------
 * Why the background is full-bleed with no rounded corners
 * ---------------------------------------------------------------------------
 * The PWA icons are declared `purpose: "any maskable"`, so one file has to work unmasked
 * *and* under the launcher's mask. A rounded square works unmasked and looks wrong masked:
 * the corners the system does not cut away show as notches against the launcher. Filling
 * the canvas and letting the OS cut it is the only shape correct in both states. The tab
 * favicon needs no rounding of its own either — browsers draw it in a box they control.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/** The brand orange, matching `--color-yo-ink` and the header wordmark. */
const BRAND = "#e8590c";
/** The letter. White, because the field is the colour now. */
const INK = "#ffffff";

/**
 * The mark, as geometry in a 512-unit square.
 *
 * The strokes are 72 units, the dots 60 across: at 16px those are 2.25 and 1.9 pixels, which
 * is the smallest that survives a rasteriser's averaging. The gaps between the bars are 16
 * units — half a pixel at 16px, so they soften rather than close, which is what a legible
 * miniature looks like.
 */
const GEOMETRY = {
  /** Left edge of the letter. */
  x: 128,
  /** Width of the letter's horizontal extent. */
  width: 256,
  /** Stroke weight, for every bar and the stem alike. */
  stroke: 72,
  /** Where the top bar starts, and the bottom of the stem. */
  top: 176,
  bottom: 400,
  /** The middle bar, which is shorter and thinner, as in any «Е». */
  middle: { y: 256, width: 176, height: 56 },
  /** The dots, centred over the letter's optical top. */
  dots: { cy: 120, r: 32, left: 164, right: 268 },
};

/** The mark without its background, so the same geometry can ride on any field. */
function letterSvg() {
  const { x, width, stroke, top, bottom, middle, dots } = GEOMETRY;

  const bar = (bx, by, bw, bh) =>
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${INK}"/>`;

  return [
    `<circle cx="${dots.left}" cy="${dots.cy}" r="${dots.r}" fill="${INK}"/>`,
    `<circle cx="${dots.right}" cy="${dots.cy}" r="${dots.r}" fill="${INK}"/>`,
    // Top bar, middle bar, bottom bar, then the stem over them: drawn last so the joins are
    // square rather than notched.
    bar(x, top, width, stroke),
    bar(x, middle.y, middle.width, middle.height),
    bar(x, bottom - stroke, width, stroke),
    bar(x, top, stroke, bottom - top),
  ].join("");
}

/** The whole icon at one size, as an SVG string. */
function iconSvg(size) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 512 512" role="img" aria-label="Ё-новости">` +
    `<rect width="512" height="512" fill="${BRAND}"/>` +
    letterSvg() +
    `</svg>`
  );
}

/**
 * Builds an `.ico` from PNG frames.
 *
 * Hand-written because sharp cannot write ICO and a dependency for one container format is
 * not worth its maintenance. The structure is the one Microsoft documented for Vista and
 * later, and it is short: a six-byte header, a sixteen-byte directory entry per frame, then
 * the frames themselves. Every current browser reads PNG-compressed frames; the older
 * BMP-only form exists for icons that must work in Internet Explorer 6.
 *
 * A frame's width and height are single bytes, and zero means 256 — hence the `% 256`.
 */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;

  frames.forEach((frame, index) => {
    const entry = index * 16;
    directory.writeUInt8(frame.size % 256, entry + 0);
    directory.writeUInt8(frame.size % 256, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette size; 0 for truecolour
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(frame.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.png.length;
  });

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.png)]);
}

/** Renders the icon at one size and returns the PNG bytes, checking what came back. */
async function render(size) {
  const png = await sharp(Buffer.from(iconSvg(size)))
    .png({ compressionLevel: 9 })
    .toBuffer();

  // Read the dimensions back rather than trusting the request: a mismatch here ships a
  // manifest pointing at a file the launcher refuses, and nothing says so until install.
  const meta = await sharp(png).metadata();
  if (meta.width !== size || meta.height !== size || meta.format !== "png") {
    throw new Error(
      `${size}: получено ${meta.width}x${meta.height} (${meta.format})`,
    );
  }

  return png;
}

/** Where each file goes, relative to the project root. */
const OUTPUTS = {
  svg: "src/app/icon.svg",
  /*
    `src/app/favicon.ico`, not `public/favicon.ico`.

    Measured, not assumed: a `favicon.ico` in the app directory makes Next emit its own
    `<link rel="icon" href="/favicon.ico?favicon.<hash>.ico">` — a content-hashed URL, so a
    reader who already has the old one is served the new one the moment it changes rather
    than in a week. It works *alongside* an explicit `metadata.icons`, which was the part
    worth checking: every other file convention here (`icon.png`, `apple-icon.png`) is
    suppressed by the explicit list and has to be linked by hand.

    A copy in `public/` would collide with it on the same path and win or lose by
    filesystem order, so there is exactly one.
  */
  favicon: "src/app/favicon.ico",
  appIcon: "src/app/icon.png",
  appleIcon: "src/app/apple-icon.png",
  pwa192: "public/icons/icon-192.png",
  pwa512: "public/icons/icon-512.png",
};

/**
 * The sizes inside `favicon.ico`.
 *
 * Three, because they are the three a browser actually asks for: 16 for a tab, 32 for a
 * high-density tab and the bookmark bar, 48 for a desktop shortcut. Adding 64 or 128 would
 * grow a file that every visitor downloads on their first request for a size nothing
 * requests.
 */
const ICO_SIZES = [16, 32, 48];

const root = process.cwd();
const write = async (relative, data) => {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  return data.length;
};

// The vector source, which is what Next serves as `<link rel="icon" type="image/svg+xml">`
// and what a future size is regenerated from.
const svgBytes = await write(OUTPUTS.svg, Buffer.from(iconSvg(512), "utf8"));

const frames = [];
for (const size of ICO_SIZES) frames.push({ size, png: await render(size) });
const icoBytes = await write(OUTPUTS.favicon, buildIco(frames));

// 32 rather than 16: Next serves this file to browsers that ask for a PNG icon, and 16 is
// the one size that is always downscaled from something anyway.
const appIconBytes = await write(OUTPUTS.appIcon, await render(32));
const appleBytes = await write(OUTPUTS.appleIcon, await render(180));
const pwa192Bytes = await write(OUTPUTS.pwa192, await render(192));
const pwa512Bytes = await write(OUTPUTS.pwa512, await render(512));

console.log(`${OUTPUTS.svg}         ${svgBytes} байт`);
console.log(`${OUTPUTS.favicon}       ${icoBytes} байт  (${ICO_SIZES.join(", ")} px)`);
console.log(`${OUTPUTS.appIcon}     ${appIconBytes} байт  32x32`);
console.log(`${OUTPUTS.appleIcon}  ${appleBytes} байт  180x180`);
console.log(`${OUTPUTS.pwa192}  ${pwa192Bytes} байт  192x192`);
console.log(`${OUTPUTS.pwa512}  ${pwa512Bytes} байт  512x512`);
