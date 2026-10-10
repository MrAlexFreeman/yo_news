/**
 * Verifies publishArticleToVk without touching the real VK API: a local stub
 * stands in for api.vk.com. Run with: npx tsx scripts/check-vk-publisher.ts
 */
import {
  buildAttachments,
  buildPostText,
  leadSummary,
  parseVkUploadResult,
  publishArticleToVk,
  VK_LEAD_MAX,
} from "../src/lib/vk-publisher";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const realFetch = globalThis.fetch;

/**
 * Stubs the VK HTTP API and records every call the module makes.
 *
 * The shapes here were taken from the live service on production, not from the API
 * documentation, and that distinction is the whole point of this stub. It used to answer
 * the upload endpoint with `{ response: { server, photo, hash } }` and the module happily
 * read `.response` — so every check passed for a year while production published every
 * single wall post as bare text, because VK's upload endpoint returns those three values
 * *unwrapped*. A stub that encodes the belief rather than the behaviour tests the belief.
 *
 * What the live service actually returns, measured:
 *   photos.getWallUploadServer → { album_id, upload_url, user_id }   // no `photo` field
 *   POST <upload_url>           → { server, photo, hash }            // no `response` wrapper
 */
function stubVk(options: {
  failUpload?: boolean;
  noPhotoId?: boolean;
  /** Fail this many upload attempts with a server-side status before succeeding. */
  uploadFailTimes?: number;
  uploadFailStatus?: number;
}) {
  const calls: { method: string; params: Record<string, string> }[] = [];
  /** One entry per attempt on the upload endpoint, so retry behaviour is assertable. */
  const uploads: {
    status: number;
    /** Field names present in the multipart body. */
    fields: string[];
    photoParts: number;
    filename: string | null;
  }[] = [];
  let remainingFailures = options.uploadFailTimes ?? 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));

    // Upload server host (upload.vk.com) — raw bytes go here.
    if (url.hostname.startsWith("upload.")) {
      const body = init?.body;
      const form = body instanceof FormData ? body : null;
      uploads.push({
        status: 200,
        fields: form ? [...form.keys()] : [],
        photoParts: form ? form.getAll("photo").length : 0,
        filename:
          form && form.get("photo") instanceof File
            ? (form.get("photo") as File).name
            : null,
      });

      if (options.failUpload) {
        uploads[uploads.length - 1].status = 500;
        return new Response("nope", { status: 500 });
      }

      if (remainingFailures > 0) {
        remainingFailures -= 1;
        uploads[uploads.length - 1].status = options.uploadFailStatus ?? 503;
        return new Response("<html>temporarily unavailable</html>", {
          status: uploads[uploads.length - 1].status,
        });
      }

      // Bare, exactly as measured against the live endpoint.
      return new Response(JSON.stringify({ server: 908118, photo: "", hash: "h_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
      return respond({ album_id: -14, upload_url: "https://upload.vk.com/photo", user_id: 7 });
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

  return { calls, uploads };
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
      withLead.endsWith("👉 Читать полностью: http://localhost:3000/news/my-slug"),
    JSON.stringify(withLead),
  );

  const noLead = buildPostText({ title: "Только заголовок", slug: "only-title" });
  check(
    "Текст поста без лида",
    !noLead.includes("undefined") &&
      noLead.endsWith("👉 Читать полностью: http://localhost:3000/news/only-title"),
    JSON.stringify(noLead),
  );

  /*
    A wall post is a teaser and the lead is written for the page, where the rest of the
    story is one click away. Pasted whole it pushes the link below a phone's fold, where VK
    truncates the post with an ellipsis and the URL never appears at all.
  */
  const longLead = buildPostText({
    title: "Длинный лид",
    lead:
      "Первое предложение лида достаточно длинное и содержит запятую. Второе предложение тоже есть. " +
      "Третье предложение, которого быть не должно в посте на стене сообщества. Четвёртое и подавно.",
    slug: "long-lead",
  });
  check(
    "Текст поста: лид обрезан до двух предложений",
    longLead.includes("Первое предложение лида") &&
      longLead.includes("Второе предложение тоже есть") &&
      !longLead.includes("Третье предложение"),
    JSON.stringify(longLead),
  );

  /*
    A single very long sentence has no sentence boundary to cut at, so the ceiling has to
    land somewhere. An ellipsis says the lead was trimmed; a hard slice ends mid-stem and
    reads as a typo.
  */
  const oneHugeSentence = leadSummary("а".repeat(500));
  check(
    "Лид: одна огромная фраза обрезается с многоточием, а не по слогам",
    oneHugeSentence.length <= VK_LEAD_MAX + 1 &&
      oneHugeSentence.endsWith("…") &&
      !/\sа…$/.test(oneHugeSentence),
    `len=${oneHugeSentence.length}, хвост=${JSON.stringify(oneHugeSentence.slice(-6))}`,
  );
  check(
    "Лид: пустой лид не даёт пустого абзаца",
    leadSummary("") === "" && leadSummary(null) === "" && leadSummary("   ") === "",
    "пусто",
  );

  // --- attachments --------------------------------------------------------
  check(
    "Вложения: без фото остаётся одна ссылка",
    buildAttachments(null, "only-link") === "http://localhost:3000/news/only-link",
    buildAttachments(null, "only-link"),
  );
  check(
    "Вложения: с фото — сначала фото, потом ссылка",
    buildAttachments("ph_9", "both") ===
      "ph_9,http://localhost:3000/news/both",
    buildAttachments("ph_9", "both"),
  );

  // --- the upload answer VK actually sends ---------------------------------
  check(
    "Ответ загрузки: голый объект принимается",
    // The shape measured on the live endpoint. Reading `.response` here is what made every
    // production post go out without a cover, while this suite stayed green throughout.
    (parseVkUploadResult({ server: 908118, photo: "", hash: "h_1" })?.server ?? 0) ===
      908118,
    JSON.stringify(parseVkUploadResult({ server: 908118, photo: "", hash: "h_1" })),
  );
  check(
    "Ответ загрузки: обёрнутый вариант тоже принимается",
    (parseVkUploadResult({ response: { server: 1, hash: "h" } })?.hash ?? "") === "h",
    JSON.stringify(parseVkUploadResult({ response: { server: 1, hash: "h" } })),
  );
  check(
    "Ответ загрузки: мусор и ошибка отвергаются",
    parseVkUploadResult(null) === null &&
      parseVkUploadResult({}) === null &&
      parseVkUploadResult({ server: "not-a-number", hash: "h" }) === null &&
      parseVkUploadResult({ server: 1 }) === null &&
      parseVkUploadResult("<html>504</html>") === null,
    "null там, где разбирать нечего",
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
  let { calls, uploads } = stubVk({});
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
  /*
    The link is an attachment even with no photo. It is what makes VK render the preview
    card; a URL that only exists inside `message` renders as blue text or as nothing,
    depending on the client.
  */
  check(
    "wall.post: ссылка в attachments даже без обложки",
    post?.params.attachments === "https://example.com/news/text-post",
    `attachments=${post?.params.attachments ?? "нет"}`,
  );
  check(
    "wall.post: ссылка на example.com",
    Boolean(post?.params.message?.includes("https://example.com/news/text-post")),
    post?.params.message?.split("\n").slice(-1)[0] ?? "",
  );
  check(
    "Текст поста: ссылка помечена «Читать полностью»",
    post?.params.message?.includes("👉 Читать полностью: https://example.com/news/text-post") ??
      false,
    JSON.stringify(post?.params.message),
  );
  check("Текстовый пост: загрузок не было", uploads.length === 0, `uploads=${uploads.length}`);

  // --- owner_id accepts the id without a minus --------------------------
  process.env.VK_COMMUNITY_ID = "123456";
  ({ calls } = stubVk({}));
  await publishArticleToVk({ title: "Без минуса", slug: "no-minus" });
  check(
    "owner_id: id без минуса нормализуется",
    calls[0]?.params.owner_id === "-123456",
    `owner_id=${calls[0]?.params.owner_id}`,
  );

  // Editors routinely paste the club URL instead of the bare id.
  process.env.VK_COMMUNITY_ID = "https://vk.ru/club241944021";
  ({ calls } = stubVk({}));
  await publishArticleToVk({ title: "Из URL", slug: "from-url" });
  check(
    "owner_id: извлекается из URL сообщества",
    calls[0]?.params.owner_id === "-241944021",
    `owner_id=${calls[0]?.params.owner_id}`,
  );

  process.env.VK_COMMUNITY_ID = "public241944021";
  ({ calls } = stubVk({}));
  await publishArticleToVk({ title: "Из slug", slug: "from-slug" });
  check(
    "owner_id: извлекается из public-slug",
    calls[0]?.params.owner_id === "-241944021",
    `owner_id=${calls[0]?.params.owner_id}`,
  );

  // A community renamed to a custom short name has a URL with no digits in it.
  // This is the value the deployment actually ships, so it must not degrade into
  // owner_id="-https://vk.ru/eartnews".
  process.env.VK_COMMUNITY_ID = "https://vk.ru/eartnews";
  ({ calls } = stubVk({}));
  await publishArticleToVk({ title: "Из кастомного слага", slug: "custom-slug" });
  check(
    "owner_id: кастомный слаг из URL -> -public<slug>",
    calls[0]?.params.owner_id === "-publiceartnews",
    `owner_id=${calls[0]?.params.owner_id}`,
  );

  process.env.VK_COMMUNITY_ID = "eartnews";
  ({ calls } = stubVk({}));
  await publishArticleToVk({ title: "Голый слаг", slug: "bare-slug" });
  check(
    "owner_id: голый слаг без URL -> -public<slug>",
    calls[0]?.params.owner_id === "-publiceartnews",
    `owner_id=${calls[0]?.params.owner_id}`,
  );

  process.env.VK_COMMUNITY_ID = "-123456";

  // --- post with cover image -------------------------------------------
  ({ calls, uploads } = stubVk({}));
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
    "С обложкой: attachments = фото + ссылка",
    calls.at(-1)?.params.attachments ===
      "ph_9,https://example.com/news/with-cover",
    `attachments=${calls.at(-1)?.params.attachments}`,
  );

  /*
    The regression that matters most. VK's upload endpoint answers with a bare
    `{ server, photo, hash }`; the module used to read `.response`, threw, and every wall
    post went out as bare text. The stub returns the bare form, so this fails if the
    reading goes back to looking for an envelope.
  */
  check(
    "Обложка: ответ сервера загрузки читается без обёртки response",
    uploads.length === 1 &&
      uploads[0].status === 200 &&
      methods.includes("photos.saveWallPhoto"),
    `uploads=${uploads.length}, методы: ${methods.join(" → ")}`,
  );

  /*
    Only the file goes into the multipart body. `server`, `photo` and `hash` as extra parts
    were being sent with the values `upload_url` and `undefined` — and getWallUploadServer
    has no `photo` field at all, as measured — which is at best noise and at worst a second
    non-file part competing with the real one for the field name.
  */
  check(
    "Обложка: в multipart только файл, без выдуманных server/photo/hash",
    uploads[0]?.fields.length === 1 && uploads[0]?.fields[0] === "photo" &&
      uploads[0]?.photoParts === 1,
    `поля=${JSON.stringify(uploads[0]?.fields)}, частей photo=${uploads[0]?.photoParts}`,
  );
  check(
    "Обложка: имя файла сохраняет реальное расширение",
    uploads[0]?.filename === "cover.jpg",
    `имя=${uploads[0]?.filename ?? "нет"}`,
  );

  /*
    Measured on production while diagnosing this: pu.vk.com answered one attempt with an
    HTTP 504 "page is temporarily unavailable" and the next with a good payload. A single
    attempt turned that transient into a wall post with no cover.
  */
  ({ calls, uploads } = stubVk({ uploadFailTimes: 2, uploadFailStatus: 504 }));
  const retriedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return retriedFetch(input, init);
  }) as typeof fetch;

  const afterOutage = await publishArticleToVk({
    title: "Обложка после сбоя",
    slug: "retried",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: 504 от VK не оставляет пост без фото",
    afterOutage.ok === true &&
      uploads.length === 3 &&
      uploads[0].status === 504 &&
      calls.at(-1)?.params.attachments ===
        "ph_9,https://example.com/news/retried",
    `попыток=${uploads.length}, attachments=${calls.at(-1)?.params.attachments}`,
  );

  // --- cover upload fails: degrade to text -----------------------------
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff]), { status: 200 });
    }
    return withCoverFetch(input, init);
  }) as typeof fetch;
  ({ calls } = stubVk({ failUpload: true }));

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
  /*
    Degraded, not abandoned: the link attachment is what makes the preview card, so a post
    without a cover still shows a headline and a description where before it showed nothing
    but blue text.
  */
  check(
    "Ошибка загрузки обложки: остаётся ссылка-вложение + warning",
    calls.at(-1)?.params.attachments === "https://example.com/news/bad-cover" &&
      typeof uploadFailed.warning === "string",
    `${calls.at(-1)?.params.attachments} / ${uploadFailed.warning ?? "нет warning"}`,
  );

  // --- wall.post itself fails -------------------------------------------
  ({ calls } = stubVk({}));
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

  await checkCoverImageReads();

  console.log("VK publisher\n");
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 110)}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

/**
 * Covers for the cover-image reader: the case that was broken.
 *
 * The publisher used to `fetch()` whatever sat in the article row. Uploads live
 * outside `public/` and are stored as `/uploads/<name>`, so Node refused the relative
 * URL outright — "Failed to parse URL from /uploads/…" — and every repost since then
 * went out with no picture, one warning line per post. The regression that matters is
 * that a relative path now resolves to real bytes; the rest guards the boundaries of
 * the disk read, which is new attack surface the HTTP fetch did not have.
 *
 * Fixtures are written into the project's own upload directory and removed in a
 * `finally`, under a name that cannot collide with an editor's upload.
 */
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { readCoverImage } from "../src/lib/vk-publisher";
import { UPLOAD_DIR } from "../src/lib/upload-dir";

const FIXTURE_PREFIX = "yn-vk-cover-check";

const IMAGE_FIXTURES = [
  {
    name: `${FIXTURE_PREFIX}.webp`,
    bytes: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]),
    type: "image/webp",
  },
  {
    name: `${FIXTURE_PREFIX}.png`,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    type: "image/png",
  },
  {
    name: `${FIXTURE_PREFIX}.jpg`,
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    type: "image/jpeg",
  },
];

async function checkCoverImageReads() {
  const written: string[] = [];

  try {
    for (const fixture of IMAGE_FIXTURES) {
      const target = path.join(UPLOAD_DIR, fixture.name);
      await writeFile(target, fixture.bytes);
      written.push(target);
    }
    // A file that is not an image, and one that is outside the upload directory: the
    // second is the boundary the disk read must not cross.
    const notImage = path.join(UPLOAD_DIR, `${FIXTURE_PREFIX}.txt`);
    await writeFile(notImage, "not an image");
    written.push(notImage);

    const outside = path.join(UPLOAD_DIR, "..", `${FIXTURE_PREFIX}.json`);
    await writeFile(outside, "{}");
    written.push(outside);

    for (const fixture of IMAGE_FIXTURES) {
      const result = await readCoverImage(`/uploads/${fixture.name}`);
      check(
        `Обложка с диска: /uploads/${fixture.name} читается`,
        Buffer.from(result.bytes).equals(fixture.bytes),
        `${result.bytes.byteLength} байт, ${result.contentType}`,
      );
      check(
        `Обложка с диска: content-type ${fixture.type}`,
        result.contentType === fixture.type,
        result.contentType,
      );
    }

    // The regression itself. This input used to throw a URL parse error.
    let relativeMessage = "";
    try {
      await readCoverImage(`/uploads/${IMAGE_FIXTURES[0]!.name}`);
    } catch (error) {
      relativeMessage = (error as Error).message;
    }
    check(
      "Обложка: относительный путь больше не даёт ошибку разбора URL",
      !/Failed to parse URL/.test(relativeMessage),
      relativeMessage || "ошибки нет",
    );

    const rejected: [string, string, string][] = [
      ["несуществующий файл", `/uploads/${FIXTURE_PREFIX}-net.webp`, "ENOENT"],
      [
        "выход за каталог загрузок",
        `/uploads/../${FIXTURE_PREFIX}.json`,
        "escapes",
      ],
      ["не изображение", `/uploads/${FIXTURE_PREFIX}.txt`, "supported image format"],
    ];

    for (const [label, input, expected] of rejected) {
      let message = "";
      try {
        await readCoverImage(input);
      } catch (error) {
        message = (error as Error).message;
      }
      check(
        `Обложка отклонена: ${label}`,
        message.includes(expected),
        message.slice(0, 100) || "ошибки не было",
      );
    }
  } finally {
    for (const target of written) {
      await rm(target, { force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
