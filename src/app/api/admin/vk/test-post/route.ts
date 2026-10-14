import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  deleteWallPost,
  publishArticleToVk,
  readWallPostAttachments,
  setVkTokenSource,
  vkCommunityId,
  vkOwnerId,
} from "@/lib/vk-publisher";

export const runtime = "nodejs";

/**
 * «Тест отправки в ВК с фото» — a real repost, on demand, from the settings page.
 *
 * ---------------------------------------------------------------------------
 * Why a button and not a check
 * ---------------------------------------------------------------------------
 * The cover has been failing in a way no unit check could see. The suite stubbed VK's upload
 * endpoint and asserted a photo came out; production was posting bare text the whole time,
 * because the endpoint answers two different HTTP 200s and only one of them carries a photo.
 * A stub tests the belief you wrote into it.
 *
 * So this button does the entire thing against the real API — reads a real cover off the disk,
 * uploads it, posts to the community wall, **reads the post back** to see what is actually
 * attached, and then removes the post. The read-back is the part that cannot be faked: it asks
 * VK, not this code, what ended up on the wall.
 *
 * ---------------------------------------------------------------------------
 * What it leaves behind
 * ---------------------------------------------------------------------------
 * Nothing, by default. The post is deleted after it has been checked, so a probe does not
 * become a public post on a news community's wall. `keep: true` skips the deletion for an
 * editor who wants to look at the result with their own eyes; the post id is returned either
 * way so it can be removed by hand afterwards.
 *
 * The photo itself stays in the wall album. `photos.delete` was measured as refused for this
 * token — error 15, "Access denied: no access to call this method" — because the photo is
 * saved under the *user's* id, not the community's. An unattached wall photo is invisible to
 * readers, and the alternative is not saving one at all.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts requires Basic Auth before this runs, and
 * the JSON content-type is required like the other settings routes: a cross-origin form must
 * not be able to make the community publish by way of a form action pointing here.
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
    // An empty body is fine here: the only field is an optional flag, so a malformed one is
    // not worth refusing the whole request over.
    body = {};
  }
  const keep = body.keep === true;

  if (!vkCommunityId()) {
    return NextResponse.json(
      {
        ok: false,
        message: "Не задан VK_COMMUNITY_ID — репостить некуда. Укажите его в .env на сервере.",
      },
      { status: 200 },
    );
  }

  /*
    A real cover from a real story, rather than a fixture.

    The path that was broken is the disk read — `/uploads/<name>` is not a URL, and the code
    once handed it to `fetch()` and got "Failed to parse URL" on every publish. Testing with
    anything else would not exercise it.

    Тело, рубрика и ключевые слова берутся у той же статьи: пост, который уходит на стену,
    должен быть тем же, что уйдёт при настоящей публикации, — иначе кнопка проверяет обложку,
    но ничего не говорит о тексте, а именно текст и был сломан.
  */
  const article = await prisma.article.findFirst({
    where: { status: "published", coverImage: { not: null } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      lead: true,
      slug: true,
      coverImage: true,
      contentHtml: true,
      category: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } },
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

  // The DB-backed token resolver, the same one a real publish installs.
  setVkTokenSource();

  console.log(
    `[vk] тестовая отправка запущена из админки: материал «${article.slug}», обложка ${article.coverImage}, keep=${keep}`,
  );

  const result = await publishArticleToVk({
    id: article.id,
    // Заголовок помечен как проверочный: если пост остаётся на стене (`keep`), его видно и
    // можно найти. Всё остальное — настоящее, включая лид, тело и хештеги.
    title: `Проверка репоста: ${article.title}`,
    lead: article.lead,
    contentHtml: article.contentHtml,
    categoryName: article.category?.name ?? null,
    tagNames: article.tags.map((link) => link.tag.name),
    slug: article.slug,
    coverImage: article.coverImage,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error ?? "ВК не принял публикацию.", postId: null },
      { status: 200 },
    );
  }

  /*
    Read back what VK says is on the post.

    `result.photoId` is what this code *sent*; the attachments here are what the wall actually
    has. They can disagree — that is the entire failure this button exists to catch — and the
    editor is told which of the two happened rather than being congratulated on either.
  */
  const attachments = result.postId
    ? await readWallPostAttachments(result.postId)
    : null;
  const photoAttached = attachments?.includes("photo") ?? false;

  const deleted = keep || !result.postId ? false : await deleteWallPost(result.postId);

  const lines = [
    `Пост создан: ${result.postId ?? "id не вернулся"}.`,
    attachments
      ? `ВК сообщает вложения: ${attachments.length > 0 ? attachments.join(", ") : "нет"}.`
      : "Не удалось прочитать пост обратно, чтобы проверить вложение.",
    photoAttached
      ? "Фото обложки прикреплено — проверка пройдена."
      : "Фото к посту НЕ прикреплено. Смотрите логи: pm2 logs uartnews | grep vk",
  ];
  if (result.warning) lines.push(`Предупреждение: ${result.warning}`);
  if (keep && result.postId) {
    // `vkOwnerId()` already carries the minus, so the address is the same shape VK prints.
    lines.push(`Пост оставлен на стене: https://vk.com/wall${vkOwnerId()}_${result.postId}`);
  } else if (deleted) {
    lines.push("Тестовый пост удалён со стены.");
  } else if (result.postId) {
    lines.push(`Пост остался на стене — удалить не удалось. id ${result.postId}`);
  }

  return NextResponse.json(
    {
      // Green only when the photo is genuinely on the post, not merely when the API said yes.
      ok: photoAttached,
      photoAttached,
      postId: result.postId,
      photoId: result.photoId,
      attachments,
      deleted,
      kept: keep,
      source: article.coverImage,
      message: lines.join(" "),
    },
    { status: 200 },
  );
}
