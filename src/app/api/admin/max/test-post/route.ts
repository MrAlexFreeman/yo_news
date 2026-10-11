import { NextResponse } from "next/server";

import { maxNotConfigured, publishArticleToMax, removeMaxMessages } from "@/lib/max-publisher";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * «Проверить публикацию в MAX» — a real post, on demand, from the settings page.
 *
 * ---------------------------------------------------------------------------
 * Why a real post rather than a test note
 * ---------------------------------------------------------------------------
 * A note proves the token and the channel and nothing else. What this module has to get right
 * is the article itself: the cover uploaded and attached, the whole text rather than a teaser,
 * and a story longer than one MAX message continued across several without losing a word. None
 * of that is exercised by "проверка связи", and all of it is what a reader would notice.
 *
 * ---------------------------------------------------------------------------
 * What it leaves behind
 * ---------------------------------------------------------------------------
 * Nothing, by default. The messages are removed after they have been checked, so a probe does
 * not stay in a news channel. `keep: true` skips the removal for an editor who wants to look at
 * the result in the app; the ids are returned either way so the post can be found by hand.
 *
 * The cover upload is not undone — MAX has no call that removes an uploaded file, and an
 * unused image reference is invisible to readers.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts requires Basic Auth before this runs, and
 * the JSON content-type is required like the other settings routes: a cross-origin form must
 * not be able to make the channel publish by way of a form action pointing here.
 */

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json(
      { ok: false, message: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: { keep?: unknown } = {};
  try {
    body = (await request.json()) as { keep?: unknown };
  } catch {
    // The only field is an optional flag, so a malformed body is not worth refusing over.
    body = {};
  }
  const keep = body.keep === true;

  const { getSetting } = await import("@/lib/settings");
  const config = {
    token: (await getSetting("MAX_BOT_TOKEN")).trim(),
    chatId: (await getSetting("MAX_CHAT_ID")).trim(),
    enabled: true,
  };

  const notConfigured = maxNotConfigured(config);
  if (notConfigured) {
    return NextResponse.json({ ok: false, message: notConfigured }, { status: 200 });
  }

  /*
    A real story, rather than a fixture — the path that was in question is the disk read of the
    cover and the whole-text post, and neither exists without an article.
  */
  const article = await prisma.article.findFirst({
    where: { status: "published", deletedAt: null, coverImage: { not: null } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      contentHtml: true,
      slug: true,
      coverImage: true,
      category: { select: { name: true } },
    },
  });

  if (!article?.coverImage) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Нет ни одного опубликованного материала с обложкой — тест нечего прикреплять. Опубликуйте материал с картинкой и повторите.",
      },
      { status: 200 },
    );
  }

  console.log(
    `[max] тестовая отправка из админки: материал «${article.slug}», обложка ${article.coverImage}, keep=${keep}`,
  );

  // `enabled` is deliberately left true above: an editor who switched auto-posting off and is
  // now checking that the credentials still work is doing exactly the right thing.
  const result = await publishArticleToMax({
    id: article.id,
    title: article.title,
    contentHtml: article.contentHtml,
    slug: article.slug,
    categoryName: article.category?.name ?? null,
    coverImage: article.coverImage,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: `${result.error ?? "MAX не принял публикацию."}${
          result.warning ? ` ${result.warning}` : ""
        }`,
        messageIds: result.messageIds ?? [],
      },
      { status: 200 },
    );
  }

  const ids = result.messageIds ?? [];
  const failed = keep ? [] : await removeMaxMessages(ids);

  const lines = [
    `Опубликовано сообщений: ${ids.length}${ids.length > 0 ? ` (${ids.join(", ")})` : ""}.`,
    result.summary ?? "MAX принял публикацию.",
  ];
  if (result.warning) lines.push(`Предупреждение: ${result.warning}`);
  if (keep) {
    lines.push("Пост оставлен в канале.");
  } else if (failed.length === 0) {
    lines.push("Тестовые сообщения удалены из канала.");
  } else {
    lines.push(`Удалить не удалось: ${failed.join(", ")} — уберите вручную.`);
  }

  return NextResponse.json(
    {
      // Green only when the post actually went out, not when the API said something.
      ok: true,
      messageIds: ids,
      deleted: !keep && failed.length === 0,
      kept: keep,
      source: article.coverImage,
      message: lines.join(" "),
    },
    { status: 200 },
  );
}
