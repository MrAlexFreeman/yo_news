/**
 * Deterministic cover artwork for the demo dataset.
 *
 * The first cut of the demo seed pointed every cover at picsum.photos. That
 * looked fine locally and then shipped broken: the VPS gets a 403 from
 * picsum.photos, the Next.js optimiser passes the 403 through verbatim, and the
 * front page rendered 28 broken-image icons. A demo dataset that depends on a
 * third-party photo service being reachable and not blocking your IP is not a
 * fixture, it is a production dependency with a bad SLA.
 *
 * So the art is generated here instead: a pure-Node PNG encoder (zlib is already
 * a dependency, nothing native, nothing downloaded) drawing a neutral duotone
 * card with the wordmark. Running the seed on a fresh machine produces the same
 * bytes every time and never touches the network.
 */

import { deflateSync } from "node:zlib";

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 800;

/* ------------------------------------------------------------------ *
 * Minimal 8-bit truecolour PNG encoder.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Filter 0 (None) on every scanline: the gradient compresses well enough. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const at = y * (1 + stride);
    raw[at] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, at + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Artwork.
 * ------------------------------------------------------------------ */

type Rgb = readonly [number, number, number];

/**
 * Curated muted duotones. A hash-derived hue would be easier, but arbitrary
 * hues on a news front page read as noise; these all sit at similar lightness
 * so any mix of covers still reads as one set.
 */
const PALETTE: readonly { readonly from: Rgb; readonly to: Rgb }[] = [
  { from: [236, 234, 230], to: [178, 190, 205] }, // cool slate
  { from: [242, 232, 219], to: [206, 180, 152] }, // warm sand
  { from: [231, 238, 235], to: [172, 200, 193] }, // pale teal
  { from: [238, 230, 236], to: [193, 174, 195] }, // muted mauve
  { from: [233, 237, 228], to: [176, 194, 160] }, // sage
  { from: [237, 230, 226], to: [196, 175, 167] }, // clay
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * «Ё» built from rectangles: one stem, three crossbars, two dots above it.
 * Drawing a glyph needs a font rasteriser, which Node does not ship, and the
 * whole point here is to have no dependencies.
 */
function drawYo(
  pixels: Uint8Array,
  cx: number,
  cy: number,
  size: number,
  shade: Rgb,
  alpha: number,
): void {
  const stem = size * 0.16;
  const bar = size * 0.125;
  const barWidth = size * 0.74;
  const x0 = cx - barWidth / 2;

  const rect = (px: number, py: number, w: number, h: number) => {
    for (let y = Math.round(py); y < Math.round(py + h); y += 1) {
      if (y < 0 || y >= COVER_HEIGHT) continue;
      for (let x = Math.round(px); x < Math.round(px + w); x += 1) {
        if (x < 0 || x >= COVER_WIDTH) continue;
        const i = (y * COVER_WIDTH + x) * 3;
        pixels[i] = mix(pixels[i], shade[0], alpha);
        pixels[i + 1] = mix(pixels[i + 1], shade[1], alpha);
        pixels[i + 2] = mix(pixels[i + 2], shade[2], alpha);
      }
    }
  };

  // Stem plus the three crossbars of the Е, top and bottom bars flush with the
  // stem so the glyph reads as Е rather than as three floating dashes.
  rect(x0, cy - size / 2, stem, size);
  rect(x0, cy - size / 2, barWidth, bar);
  rect(x0, cy - bar / 2, barWidth * 0.76, bar);
  rect(x0, cy + size / 2 - bar, barWidth, bar);

  // The diaeresis: two dots spread across the upper bar, clear of the stem.
  const dot = size * 0.125;
  const spread = size * 0.055;
  const dotY = cy - size / 2 - size * 0.17;
  rect(x0 + barWidth * 0.34, dotY, dot, dot);
  rect(x0 + barWidth * 0.34 + dot + spread, dotY, dot, dot);
}

/** A hairline rule near the bottom, echoing the masthead's double border. */
function drawRule(
  pixels: Uint8Array,
  y: number,
  shade: Rgb,
  alpha: number,
): void {
  const inset = Math.round(COVER_WIDTH * 0.08);
  for (let x = inset; x < COVER_WIDTH - inset; x += 1) {
    for (let dy = 0; dy < 2; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= COVER_HEIGHT) continue;
      const i = (yy * COVER_WIDTH + x) * 3;
      pixels[i] = mix(pixels[i], shade[0], alpha);
      pixels[i + 1] = mix(pixels[i + 1], shade[1], alpha);
      pixels[i + 2] = mix(pixels[i + 2], shade[2], alpha);
    }
  }
}

/**
 * Draws the card and returns PNG bytes. Deterministic in `seed`.
 */
export function renderCoverPng(seed: string): Buffer {
  const { from, to } = PALETTE[hash(seed) % PALETTE.length];
  const pixels = new Uint8Array(COVER_WIDTH * COVER_HEIGHT * 3);

  // Diagonal gradient plus a soft off-centre highlight, so the card has some
  // depth instead of reading as a flat swatch.
  const hx = COVER_WIDTH * 0.32;
  const hy = COVER_HEIGHT * 0.28;
  const maxD = Math.hypot(COVER_WIDTH, COVER_HEIGHT);

  for (let y = 0; y < COVER_HEIGHT; y += 1) {
    for (let x = 0; x < COVER_WIDTH; x += 1) {
      const t =
        0.06 +
        ((x / COVER_WIDTH) * 0.4 + (y / COVER_HEIGHT) * 0.6) * 0.94;
      const glow = Math.max(0, 1 - Math.hypot(x - hx, y - hy) / (maxD * 0.55));
      const lift = glow * glow * 0.07;

      const i = (y * COVER_WIDTH + x) * 3;
      pixels[i] = Math.min(255, mix(from[0], to[0], t) + lift * 255);
      pixels[i + 1] = Math.min(255, mix(from[1], to[1], t) + lift * 255);
      pixels[i + 2] = Math.min(255, mix(from[2], to[2], t) + lift * 255);
    }
  }

  drawYo(pixels, COVER_WIDTH / 2, COVER_HEIGHT * 0.47, COVER_HEIGHT * 0.42, to, 0.5);
  drawRule(pixels, Math.round(COVER_HEIGHT * 0.9), to, 0.4);

  return encodePng(COVER_WIDTH, COVER_HEIGHT, pixels);
}

/**
 * The site-wide fallback served when a stored cover URL fails to load.
 *
 * Deliberately one fixed tone rather than a palette pick: it is not tied to any
 * article, it may be cropped to a square, a 16:9 or a 3:2 slot depending on where
 * it lands, and it should read as "no artwork" rather than as one more picture.
 * Run this to refresh public/placeholder.png.
 */
export function renderPlaceholderPng(): Buffer {
  const from: Rgb = [238, 236, 232];
  const to: Rgb = [206, 204, 198];
  const pixels = new Uint8Array(COVER_WIDTH * COVER_HEIGHT * 3);

  for (let y = 0; y < COVER_HEIGHT; y += 1) {
    for (let x = 0; x < COVER_WIDTH; x += 1) {
      const t = 0.1 + ((x / COVER_WIDTH) * 0.35 + (y / COVER_HEIGHT) * 0.55) * 0.8;
      const i = (y * COVER_WIDTH + x) * 3;
      pixels[i] = mix(from[0], to[0], t);
      pixels[i + 1] = mix(from[1], to[1], t);
      pixels[i + 2] = mix(from[2], to[2], t);
    }
  }

  drawYo(pixels, COVER_WIDTH / 2, COVER_HEIGHT / 2, COVER_HEIGHT * 0.3, to, 0.45);

  return encodePng(COVER_WIDTH, COVER_HEIGHT, pixels);
}

/** Stable, filesystem-safe file name for a slug's cover. */
export function coverFileName(slug: string): string {
  return `${slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "cover"}.png`;
}

/** Site-relative path stored in `Article.coverImage`. */
export function coverPath(slug: string): string {
  return `/uploads/${coverFileName(slug)}`;
}