/**
 * Generates the PWA launcher icons from the same construction as src/app/icon.tsx.
 *
 * **Why the mark is drawn as rectangles rather than set as text.** `icon.tsx` renders a
 * sans-serif «Е» through the runtime's own font, which is available on the machine that
 * serves it. These files are generated once and committed, so a rasteriser has to draw the
 * letter itself: sharp resolves SVG text against whatever fonts the *build machine* happens
 * to have, and a box with neither DejaVu nor Liberation installed silently produces a blank
 * glyph. An «Е» is three bars and a stem, so it is drawn as exactly that — and a geometric
 * mark is also what stays legible at 48px, which is where a serif letter turns to mush.
 *
 * **Why the background is full-bleed.** Both icons are declared `purpose: "any maskable"`,
 * which means one file has to work unmasked *and* under the launcher's mask. A rounded
 * square works unmasked and looks wrong masked: the corners the system does not cut away
 * show as dark notches against the launcher's background. Filling the canvas and letting the
 * OS cut it is the only shape that is correct in both states.
 *
 * Run with: node scripts/generate-pwa-icons.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/** Colours, matching src/app/icon.tsx. */
const INK = "#0d1014";
const LETTER = "#e8590c";
const DOT = "#f59e0b";

/** The two sizes the manifest declares, plus the iOS home-screen icon. */
const TARGETS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

/**
 * The mark, in a 512-unit square, as plain geometry.
 *
 * The whole group is centred and spans about 260 units, which keeps it inside the maskable
 * safe zone — the central circle of 80% diameter, a 205-unit radius here. A launcher mask
 * can be a circle, a squircle or a rounded square, and the safe zone is the intersection of
 * all of them; anything outside it gets cropped, so the dots would be the first thing to go.
 */
function iconSvg(size) {
  const k = size / 512;

  // Bars of the «Е», measured from the top-left of the 512 grid.
  const stem = { x: 176, y: 150, w: 42, h: 212 };
  const top = { x: 176, y: 150, w: 160, h: 40 };
  const middle = { x: 176, y: 236, w: 132, h: 40 };
  const bottom = { x: 176, y: 322, w: 160, h: 40 };

  const rect = ({ x, y, w, h }) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${LETTER}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${INK}"/>
  <g transform="scale(${k})">
    <circle cx="238" cy="112" r="17" fill="${DOT}"/>
    <circle cx="292" cy="112" r="17" fill="${DOT}"/>
    ${rect(top)}
    ${rect(middle)}
    ${rect(bottom)}
    ${rect(stem)}
  </g>
</svg>`;
}

const outDir = path.resolve(process.cwd(), "public");
await mkdir(outDir, { recursive: true });

for (const { file, size } of TARGETS) {
  const png = await sharp(Buffer.from(iconSvg(size)))
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(path.join(outDir, file), png);

  // Read the dimensions back rather than trusting the request: a mismatch here would ship a
  // manifest pointing at a file the launcher will not accept, and it is silent until install.
  const meta = await sharp(png).metadata();
  if (meta.width !== size || meta.height !== size || meta.format !== "png") {
    throw new Error(
      `${file}: получено ${meta.width}x${meta.height} (${meta.format}), ожидалось ${size}x${size} png`,
    );
  }

  console.log(`public/${file}  ${size}x${size}  ${png.length} байт`);
}