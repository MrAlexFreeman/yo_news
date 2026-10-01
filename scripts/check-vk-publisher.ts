/**
 * Verifies publishArticleToVk without touching the real VK API: a local stub
 * stands in for api.vk.com. Run with: npx tsx scripts/check-vk-publisher.ts
 */
import { buildPostText, publishArticleToVk } from "../src/lib/vk-publisher";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const realFetch = globalThis.fetch;

/** Stubs the VK HTTP API and records every call the module makes. */
function stubVk(options: { failUpload?: boolean; noPhotoId?: boolean }) {
  const calls: { method: string; params: Record<string, string> }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    // Upload server host (upload.vk.com) — raw bytes go here.
    if (url.hostname.startsWith("upload.")) {
      if (options.failUpload) {
        return new Response("nope", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          response: { server: 12345, photo: "ph_1", hash: "h_1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const method = url.pathname.split("/").pop() ?? "";
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ method, params });

    const respond = (body: unknown) =>
      new Response(JSON.stringify({ response: body }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (method === "photos.getWallUploadServer") {
      return respond({ upload_url: "https://upload.vk.com/photo", photo: "ph_0" });
    }
    if (method === "photos.saveWallPhoto") {
      return respond(options.noPhotoId ? {} : { server: 1, photo: "ph_9", hash: "h" });
    }
    if (method === "wall.post") {
      return respond({ post_id: 555 });
    }

    return new Response(
      JSON.stringify({ error: { error_code: 3, error_msg: "unknown method" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  return calls;
}

async function main() {
  // --- post text ---------------------------------------------------------
  const withLead = buildPostText({
    title: "Заголовок",
    lead: "Лид материала",
    slug: "my-slug",
  });
  check(
    "Текст поста: заголовок, лид, ссылка",
    withLead.includes("Заголовок") &&
      withLead.includes("Лид материала") &&
      withLead.endsWith("http://localhost:3000/news/my-slug"),
    JSON.stringify(withLead),
  );

  const noLead = buildPostText({ title: "Только заголовок", slug: "only-title" });
  check(
    "Текст поста без лида",
    !noLead.includes("undefined") &&
      noLead.endsWith("http://localhost:3000/news/only-title"),
    JSON.stringify(noLead),
  );

  // --- no credentials ----------------------------------------------------
  const savedId = process.env.VK_COMMUNITY_ID;
  const savedToken = process.env.VK_ACCESS_TOKEN;
  delete process.env.VK_COMMUNITY_ID;
  delete process.env.VK_ACCESS_TOKEN;

  const noCreds = await publishArticleToVk({ title: "T", slug: "s" });
  check(
    "Без токенов — ok:false, без throw",
    noCreds.ok === false && typeof noCreds.error === "string",
    noCreds.error ?? "нет ошибки",
  );

  process.env.VK_COMMUNITY_ID = "-123456";
  process.env.VK_ACCESS_TOKEN = "test-token";
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";

  // --- text-only post ----------------------------------------------------
  let calls = stubVk({});
  const textOnly = await publishArticleToVk({ title: "Текстовый пост", slug: "text-post" });
  check("Текстовый пост: ok", textOnly.ok === true, JSON.stringify(textOnly));
  check(
    "Текстовый пост: только wall.post",
    calls.length === 1 && calls[0].method === "wall.post",
    calls.map((c) => c.method).join(", "),
  );

  const post = calls[0];
  check(
    "wall.post: from_group=1",
    post?.params.from_group === "1",
    `from_group=${post?.params.from_group}`,
  );
  check(
    "wall.post: owner_id отрицательный",
    post?.params.owner_id === "-123456",
    `owner_id=${post?.params.owner_id}`,
  );
  check(
    "wall.post: без attachments без обложки",
    post?.params.attachments === undefined,
    `attachments=${post?.params.attachments ?? "нет"}`,
  );
  check(
    "wall.post: ссылка наexample.com",
    Boolean(post?.params.message?.includes("https://example.com/news/text-post")),
    post?.params.message?.split("\n").slice(-1)[0] ?? "",
  );

  // --- owner_id accepts the id without a minus --------------------------
  process.env.VK_COMMUNITY_ID = "123456";
  calls = stubVk({});
  await publishArticleToVk({ title: "Без минуса", slug: "no-minus" });
  check(
    "owner_id: id без минуса нормализуется",
    calls[0]?.params.owner_id === "-123456",
    `owner_id=${calls[0]?.params.owner_id}`,
  );
  process.env.VK_COMMUNITY_ID = "-123456";

  // --- post with cover image -------------------------------------------
  calls = stubVk({});
  // Stub the cover fetch too: hostname example.com must return image bytes.
  const withCoverFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return withCoverFetch(input, init);
  }) as typeof fetch;

  const withCover = await publishArticleToVk({
    title: "С обложкой",
    slug: "with-cover",
    coverImage: "https://example.com/cover.jpg",
  });

  check("С обложкой: ok", withCover.ok === true, JSON.stringify(withCover));
  const methods = calls.map((c) => c.method);
  check(
    "С обложкой: полный цикл загрузки",
    methods.includes("photos.getWallUploadServer") &&
      methods.includes("photos.saveWallPhoto") &&
      methods.includes("wall.post"),
    methods.join(" → "),
  );
  check(
    "С обложкой: attachment = photo id",
    calls.at(-1)?.params.attachments === "ph_9",
    `attachments=${calls.at(-1)?.params.attachments}`,
  );

  // --- cover upload fails: degrade to text -----------------------------
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff]), { status: 200 });
    }
    return withCoverFetch(input, init);
  }) as typeof fetch;
  calls = stubVk({ failUpload: true });

  const uploadFailed = await publishArticleToVk({
    title: "Обложка не грузится",
    slug: "bad-cover",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Ошибка загрузки обложки: пост всё равно уходит",
    uploadFailed.ok === true && calls.at(-1)?.method === "wall.post",
    JSON.stringify(uploadFailed),
  );
  check(
    "Ошибка загрузки обложки: без attachments + warning",
    calls.at(-1)?.params.attachments === undefined &&
      typeof uploadFailed.warning === "string",
    uploadFailed.warning ?? "нет warning",
  );

  // --- wall.post itself fails -------------------------------------------
  calls = stubVk({});
  const realCall = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/wall.post")) {
      return new Response(
        JSON.stringify({
          error: { error_code: 15, error_msg: "Access denied" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realCall(input, init);
  }) as typeof fetch;

  const postFailed = await publishArticleToVk({ title: "Ошибка поста", slug: "fail" });
  check(
    "Ошибка wall.post: ok:false, без throw",
    postFailed.ok === false && (postFailed.error?.includes("Access denied") ?? false),
    postFailed.error ?? "нет ошибки",
  );

  globalThis.fetch = realFetch;
  if (savedId === undefined) delete process.env.VK_COMMUNITY_ID;
  else process.env.VK_COMMUNITY_ID = savedId;
  if (savedToken === undefined) delete process.env.VK_ACCESS_TOKEN;
  else process.env.VK_ACCESS_TOKEN = savedToken;

  console.log("VK publisher\n");
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
