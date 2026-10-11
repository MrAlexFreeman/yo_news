/**
 * Дозаполнение обложек у старых постов стены ВК.
 *
 * Run from the project root:
 *   npx tsx --env-file=.env scripts/backfill-vk-covers.mts          # сухой прогон
 *   npx tsx --env-file=.env scripts/backfill-vk-covers.mts --apply  # вносит правки
 *
 * ---------------------------------------------------------------------------
 * Зачем
 * ---------------------------------------------------------------------------
 * Until the cover upload was fixed, every repost went out as bare text — the live wall showed
 * 27 posts in a row with no attachments at all. The fix only helps posts made after it, and
 * the old ones can be repaired in place: `wall.edit` adds an attachment to a post that is
 * already on the wall, which was measured against the live API together with the one trap it
 * has — an edit that does not carry `message` **empties the post's text**.
 *
 * ---------------------------------------------------------------------------
 * Безопасность
 * ---------------------------------------------------------------------------
 * Dry run unless `--apply` is passed: it prints exactly which post would get which picture and
 * touches nothing. Only posts that currently have no attachments are considered, so running it
 * twice is a no-op the second time. A post whose article cannot be found, or whose article has
 * no cover, is reported and skipped rather than guessed at.
 *
 * The token is read straight from the settings table rather than through `@/lib/settings`,
 * which is `server-only` and refuses to load outside the Next runtime.
 */

import { setVkTokenSource } from "@/lib/vk-publisher";
import {
  editWallPostAttachments,
  extractArticleSlug,
  listWallPosts,
  uploadCoverAttachment,
  vkCommunityId,
} from "@/lib/vk-publisher";

const apply = process.argv.includes("--apply");

async function main() {
  if (!vkCommunityId()) {
    console.error("VK_COMMUNITY_ID не задан — запускать не с чем (нужен --env-file=.env).");
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import("@/lib/prisma");
  try {
    const token = await prisma.appSetting.findUnique({ where: { key: "VK_ACCESS_TOKEN" } });
    if (!token?.value) {
      console.error("Токен ВК не задан ни в базе, ни в .env.");
      process.exitCode = 1;
      return;
    }
    setVkTokenSource(async () => token.value);

    const posts = await listWallPosts(100);
    const naked = posts.filter((post) => post.attachments.length === 0);

    console.log(`Всего постов на стене: ${posts.length}`);
    console.log(`Без вложений: ${naked.length}`);
    console.log(apply ? "РЕЖИМ: правки вносятся\n" : "РЕЖИМ: сухой прогон, ничего не меняется\n");

    // One upload per distinct slug, not per post: four of these posts are copies of the same
    // story, and uploading the same file four times would be four times the flaky work.
    const attachmentBySlug = new Map<string, string>();
    let repaired = 0;
    let skipped = 0;
    let failed = 0;

    for (const post of naked) {
      const slug = extractArticleSlug(post.text);
      if (!slug) {
        console.log(`  ${post.id}: пропуск — в тексте нет ссылки на материал`);
        skipped += 1;
        continue;
      }

      const article = await prisma.article.findUnique({
        where: { slug },
        select: { coverImage: true },
      });

      if (!article?.coverImage) {
        console.log(`  ${post.id}: пропуск — материал «${slug}» не найден или без обложки`);
        skipped += 1;
        continue;
      }

      console.log(`  ${post.id}: «${slug}» ← ${article.coverImage}`);
      if (!apply) continue;

      try {
        let attachment = attachmentBySlug.get(slug);
        if (!attachment) {
          attachment = await uploadCoverAttachment(article.coverImage);
          attachmentBySlug.set(slug, attachment);
        }

        const after = await editWallPostAttachments(post.id, post.text, attachment);
        if (after?.includes("photo")) {
          console.log(`      обложка на посте: ${attachment}`);
          repaired += 1;
        } else {
          console.error(`      вложение не подтвердилось: ${JSON.stringify(after)}`);
          failed += 1;
        }
      } catch (error) {
        console.error(
          `      ошибка: ${error instanceof Error ? error.message : String(error)}`,
        );
        failed += 1;
      }
    }

    if (apply) {
      console.log(
        `\nГотово: исправлено ${repaired}, пропущено ${skipped}, ошибок ${failed}, обложек загружено ${attachmentBySlug.size}`,
      );
    } else {
      const uploads = new Set<string>();
      for (const post of naked) {
        const slug = extractArticleSlug(post.text);
        if (slug) uploads.add(slug);
      }
      console.log(`\nСухой прогон: будет загружено обложек — ${uploads.size}, правок — ${naked.length}`);
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
