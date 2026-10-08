import { NextResponse } from "next/server";

import { normalizeArticleHtml } from "@/lib/article-html";
import { prisma } from "@/lib/prisma";
import { RewriteError, rewriteArticle } from "@/lib/rewriter";
import { sanitizeArticleHtml } from "@/lib/sanitize";

export const runtime = "nodejs";
/** Reads the settings table for the key on every call. */
export const dynamic = "force-dynamic";

/**
 * "Рерайт через DeepSeek" for the article form.
 *
 * Two ways in, and they are the same call: from a wire item (`feedId`, which brings the
 * source text and the original headline) or from whatever is already in the editor
 * (`title`/`content`, so an editor who pasted something themselves can still use it).
 *
 * Under /api/admin/, so Basic Auth applies. `POST` requires application/json — the
 * same CSRF reasoning as the rest of the editorial API, and here the stakes are the
 * account balance rather than a row.
 *
 * The answer is normalised and sanitised before it is returned. It is about to be put
 * into the visual editor and then stored, and running it through the same two steps the
 * rest of the body goes through means a model that answers with a `<script>`, or with
 * markdown, cannot put either into an article.
 */

/**
 * Each call costs money and a double-click on a slow connection is a real way to pay
 * twice. Same idea as the cover generator's cooldown, a little longer because this
 * call is bigger.
 */
const COOLDOWN_MS = 10_000;
let lastRequestAt = 0;

type RequestBody = {
  feedId?: unknown;
  title?: unknown;
  lead?: unknown;
  content?: unknown;
};

function asString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const feedId = asString(body.feedId, 64);
  let title = asString(body.title, 500);
  let rawText = asString(body.content, 20_000);
  let source: string | null = null;
  let originalUrl: string | null = null;

  if (feedId) {
    const item = await prisma.newsFeedItem.findUnique({
      where: { id: feedId },
      select: { title: true, rawText: true, source: true, originalUrl: true },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Инфоповод не найден — возможно, его удалили." },
        { status: 404 },
      );
    }

    // The stored item wins over anything typed into the form: the point of passing
    // `feedId` is that this is the source story.
    title = item.title;
    rawText = item.rawText;
    source = item.source;
    originalUrl = item.originalUrl;
  }

  if (!title && !rawText) {
    return NextResponse.json(
      { error: "Нечего переписывать: добавьте текст материала или откройте инфоповод." },
      { status: 400 },
    );
  }

  // Validation first, cooldown second: a rejected request must not burn the editor's
  // window, or a typo would be answered with "подождите".
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
    const result = await rewriteArticle({ title, rawText, source, originalUrl });

    // Normalise before sanitising: the model sometimes returns prose that only looks
    // like HTML, and `normalizeArticleHtml` is what turns blank-line-separated text into
    // paragraphs. Sanitising afterwards means nothing it produced reaches the editor
    // unwrapped or unvetted.
    const contentHtml = sanitizeArticleHtml(normalizeArticleHtml(result.contentHtml));

    console.log(
      `[rewrite] ${source ?? "форма"}: «${result.title.slice(0, 60)}» (${contentHtml.length} символов)`,
    );

    return NextResponse.json({
      ok: true,
      title: result.title,
      lead: result.lead,
      contentHtml,
    });
  } catch (error) {
    if (error instanceof RewriteError) {
      // 503 for configuration, 502 for a provider that is up but unhappy: the editor
      // needs to tell "fix the key" from "try again".
      const status = error.kind === "config" ? 503 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[rewrite] неожиданная ошибка", error);
    return NextResponse.json(
      { error: "Не удалось выполнить рерайт. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
