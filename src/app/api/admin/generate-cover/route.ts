import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  AI_HINT_LIMIT,
  AiCoverError,
  MAX_TITLE_LENGTH,
  buildPhotoPrompt,
  describePrompt,
  renderCover,
} from "@/lib/ai-cover";
import { UPLOAD_DIR } from "@/lib/upload-dir";

export const runtime = "nodejs";

/**
 * Generates a story cover with DeepSeek + DeepInfra FLUX-1-schnell.
 *
 * Sits under /api/admin/, so the matcher in src/proxy.ts puts Basic Auth in front
 * of it before this handler runs — an anonymous call never reaches the API keys.
 */

/**
 * Minimum seconds between two generations, per process.
 *
 * Each call costs money on DeepInfra, and Basic Auth alone does not stop a
 * cross-site form post from an editor's authenticated browser — see the
 * Content-Type check below for how that is handled. This is a cheap second
 * line: a person regenerating five covers in a row waits a few seconds instead
 * of burning the balance instantly.
 */
const COOLDOWN_MS = 5_000;

let lastRequestAt = 0;

/**
 * A single JSON envelope rather than per-field errors: the editor submits a
 * combination of fields and the actionable message depends on which is missing.
 *
 * There is no `mode`. The endpoint used to accept either a story or a hint, and
 * the hint silently replaced the story; now both are always sent and the hint
 * refines the story, so there is nothing left to choose between.
 */
type RequestBody = {
  prompt?: unknown;
  title?: unknown;
  lead?: unknown;
  content?: unknown;
};

function asString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * Rejects anything that is not `application/json`.
 *
 * This is the CSRF defence, and it is load-bearing: a cross-origin `fetch` with a
 * JSON content type triggers a preflight, which fails because no CORS headers are
 * sent, while an HTML form can only send urlencoded/multipart/text-plain — whose
 * body is not valid JSON. Requiring the type means a page on another origin
 * cannot spend the account's DeepInfra credit. Basic Auth is not a CSRF token and
 * browsers attach its cached credentials to cross-origin requests.
 */
function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Тело запроса не является JSON." },
      { status: 400 },
    );
  }

  const title = asString(body.title, MAX_TITLE_LENGTH);
  const lead = asString(body.lead, 1000);
  const content = asString(body.content, 8000);
  const hint = asString(body.prompt, AI_HINT_LIMIT);

  // Cheap validation first, rate limit second. A rejected request must not burn
  // the editor's window: someone who mistypes a hint and immediately retries
  // would otherwise be told to wait because of their own typo.
  //
  // A hint on its own is no longer enough: it is a refinement, and with no story
  // to refine there is nothing for DeepSeek to anchor it to.
  if (!title && !lead && !content) {
    return NextResponse.json(
      { error: "Нечего описать: добавьте заголовок, лид или текст материала." },
      { status: 400 },
    );
  }

  // Only now, with a request that would actually cost money, take a slot.
  const now = Date.now();
  const waitMs = COOLDOWN_MS - (now - lastRequestAt);
  if (waitMs > 0) {
    return NextResponse.json(
      { error: `Подождите ${Math.ceil(waitMs / 1000)} с и повторите.` },
      { status: 429 },
    );
  }
  lastRequestAt = now;

  try {
    // Title, lead, body and the editor's hint all go to DeepSeek in one message:
    // the hint is the visual focus, the story is the context it has to stay inside.
    const draft = await buildPhotoPrompt({ title, lead, content, hint });

    // renderCover appends the style postfix, so `sent` is what FLUX actually saw.
    const { bytes, prompt: sent } = await renderCover(draft);
    const filename = await store(bytes);

    console.log(`[ai-cover] ${filename} ← ${describePrompt(sent)}`);

    return NextResponse.json(
      { url: `/uploads/${filename}`, prompt: describePrompt(sent) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AiCoverError) {
      // 503 for missing configuration, 502 for an upstream that is up but
      // unhappy: the editor needs to tell "fix the .env" from "try again".
      const status = error.message.includes(".env") ? 503 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[ai-cover] unexpected failure", error);
    return NextResponse.json(
      { error: "Не удалось сгенерировать обложку. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}

/**
 * Writes the rendered image into UPLOAD_DIR as WebP.
 *
 * The extension comes from what sharp reports about the actual bytes, never from
 * a filename or a content-type in the upstream response — an attacker-controlled
 * string must not be able to decide what lands on disk. PNG in, WebP out: FLUX
 * returns PNG, and PNG of a 1024×576 image is several times the weight for no
 * visible gain in a thumbnail.
 */
async function store(bytes: Buffer): Promise<string> {
  const filename = `ai-cover-${randomUUID()}.webp`;
  const target = path.join(UPLOAD_DIR, filename);

  try {
    // Imported here rather than at module scope: sharp is a native module and
    // loading it eagerly would cost memory on a request path that may 503 first.
    const { default: sharp } = await import("sharp");

    const webp = await sharp(bytes)
      .rotate()
      .webp({ quality: 82 })
      .toBuffer();

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(target, webp);
  } catch (error) {
    throw new AiCoverError(
      `Не удалось сохранить изображение: ${error instanceof Error ? error.message : "неизвестная ошибка"}`,
      "save",
    );
  }

  return filename;
}