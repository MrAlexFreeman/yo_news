/**
 * Verifies publishArticleToVk without touching the real VK API: a local stub
 * stands in for api.vk.com. Run with: npx tsx scripts/check-vk-publisher.ts
 */
import {
  buildAttachments,
  buildPostText,
  deleteWallPost,
  editWallPostAttachments,
  extractArticleSlug,
  listWallPosts,
  padVerticalCover,
  parseVkUploadResult,
  planWallDedupe,
  publishArticleToVk,
  readWallPostAttachments,
  resetVkRetrySleep,
  setVkRetrySleep,
  UPLOAD_ATTEMPTS,
  VK_MAX_TAGS,
  VK_MESSAGE_LIMIT,
  VK_TEXT_LIMIT,
  vkCommunityGroupId,
  vkPhotoAttachmentId,
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
  /** Answer this many attempts with the measured 200-but-empty `photo` before succeeding. */
  emptyPhotoTimes?: number;
  /** Report a post with no photo attached, for the read-back used by the test button. */
  attachmentMissing?: boolean;
  /**
   * Report the measured glitch: `wall.post` succeeds, the post comes back with no attachment,
   * and `wall.edit` is what repairs it.
   */
  dropAttachmentOnce?: boolean;
  /** Refuse the repair, so the warning path is exercised. */
  editFails?: boolean;
}) {
  const calls: { method: string; params: Record<string, string>; httpMethod: string }[] = [];
  /** One entry per attempt on the upload endpoint, so retry behaviour is assertable. */
  const uploads: {
    status: number;
    /** Field names present in the multipart body. */
    fields: string[];
    photoParts: number;
    filename: string | null;
  }[] = [];
  let remainingFailures = options.uploadFailTimes ?? 0;
  let remainingEmpty = options.emptyPhotoTimes ?? 0;
  /** Starts true unless this stub is simulating VK dropping the attachment. */
  let attachmentOnPost = !options.dropAttachmentOnce && !options.attachmentMissing;

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

      /*
        The measured failure shape: HTTP 200 with an empty `photo`.

        It is not the default here on purpose. This stub used to answer `photo: ""` on every
        attempt while the suite asserted that a cover came out of it — so the checks agreed
        with the module's wrong belief and production posted bare text for as long as it took
        someone to read the live responses. `photo: ""` is a *failed* upload, and
        saveWallPhoto refuses it with error 100.
      */
      if (remainingEmpty > 0) {
        remainingEmpty -= 1;
        return new Response(JSON.stringify({ server: 908118, photo: "", hash: "h_empty" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // The measured success shape, bare, exactly as the live endpoint sends it. `photo` is a
      // non-empty JSON string — the server-side handle that saveWallPhoto needs.
      return new Response(
        JSON.stringify({
          server: 908118,
          photo: JSON.stringify([{ markers_restarted: true, photo: "9bce4ffabc:w", sizes: [] }]),
          hash: "h_1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const method = url.pathname.split("/").pop() ?? "";
    /*
      Параметры читаются из тела POST, потому что так их теперь и отправляют: строкой запроса
      пост на 4000 знаков не проходит (см. `callVk`). Строка запроса остаётся запасным
      источником, чтобы заглушка не разошлась с кодом, если вызов когда-нибудь вернут на GET.
    */
    const payload = typeof init?.body === "string" ? init.body : url.search;
    const params = Object.fromEntries(new URLSearchParams(payload).entries());
    calls.push({ method, params, httpMethod: init?.method ?? "GET" });

    const respond = (body: unknown) =>
      new Response(JSON.stringify({ response: body }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (method === "photos.getWallUploadServer") {
      // Measured: album_id, upload_url, user_id — and no `photo` field, which the module
      // used to read and put into the multipart body as `undefined`.
      return respond({ album_id: -14, upload_url: "https://upload.vk.com/photo", user_id: 7 });
    }
    if (method === "photos.saveWallPhoto") {
      // The measured shape: an array of photo objects, not the documented `{ photo: string }`.
      // Reading `.photo` off this yields undefined, which is how a cover gets uploaded,
      // paid for and then dropped from the post.
      return respond(
        options.noPhotoId
          ? {}
          : [{ album_id: -14, id: 457240126, owner_id: 276313599, access_key: "k" }],
      );
    }
    if (method === "groups.getById") {
      // Measured against the live service: a numeric id and the short name "eartnews" both
      // answer the same community, so a slug-configured deployment can resolve the numeric
      // group_id the photo methods require.
      return respond({ groups: [{ id: 241944021, name: "Ёновости", screen_name: "eartnews" }] });
    }
    if (method === "wall.post") {
      return respond({ post_id: 555 });
    }
    if (method === "wall.getById") {
      // Measured: `attachments` is an array of objects carrying a `type`, and it is what the
      // test button reads to tell "the post has a photo" from "the upload said 200".
      return respond({
        items: [
          {
            id: 555,
            attachments: attachmentOnPost ? [{ type: "photo" }] : [],
          },
        ],
      });
    }
    if (method === "wall.get") {
      return respond({
        count: 2,
        items: [
          {
            id: 900,
            date: 1000,
            text: "Заголовок\n\n👉 Читать полностью: https://eartnews.ru/news/one",
            attachments: [],
          },
          { id: 901, date: 2000, text: "Уже с картинкой", attachments: [{ type: "photo" }] },
        ],
      });
    }
    if (method === "wall.edit") {
      // Measured against the live service: a post created with no attachment came back with
      // `attachments: ["photo"]` after wall.edit was given one.
      if (options.editFails) {
        return new Response(
          JSON.stringify({ error: { error_code: 100, error_msg: "Access denied" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      attachmentOnPost = true;
      return respond({ post_id: 555 });
    }
    if (method === "wall.delete") {
      return respond(1);
    }

    return new Response(
      JSON.stringify({ error: { error_code: 3, error_msg: "unknown method" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  return { calls, uploads };
}

async function main() {
  /*
    The real backoff between upload attempts is a fifteen-second sleep in the worst case,
    and the suite deliberately provokes that case. Replaced rather than shortened so the
    number under test stays the one production uses.
  */
  setVkRetrySleep(async () => {});

  // --- post text ---------------------------------------------------------
  /*
    Пост на стене — это текст статьи, а не анонс.

    Раньше в ВК уходил заголовок и две фразы лида: в ленте это читалось как «заголовок со
    ссылкой», и о чём материал, видно не было. Проверки ниже стерегут именно полноту — тело,
    лид, ссылку и хештеги, — а не факт, что строка собралась.
  */
  const withBody = buildPostText({
    title: "Заголовок",
    lead: "Лид материала",
    contentHtml: "<p>Первый абзац тела.</p><p>Второй абзац тела.</p>",
    categoryName: "Общество",
    tagNames: ["Екатеринбург"],
    slug: "my-slug",
  });
  check(
    "Текст поста: заголовок, лид, тело, ссылка и хештеги",
    withBody.startsWith(
      "Заголовок\n\nЛид материала\n\nПервый абзац тела.\n\nВторой абзац тела.",
    ) &&
      withBody.endsWith(
        "👉 Читать на сайте: http://localhost:3000/news/my-slug\n#Общество #Екатеринбург",
      ),
    JSON.stringify(withBody),
  );

  const minimumPost = buildPostText({ title: "Только заголовок", slug: "only-title" });
  check(
    "Текст поста: без лида и тела пустых абзацев нет",
    minimumPost ===
      "Только заголовок\n\n👉 Читать на сайте: http://localhost:3000/news/only-title",
    JSON.stringify(minimumPost),
  );
  check(
    "Текст поста: без рубрики и слов строки хештегов нет",
    !(minimumPost.split("\n").at(-1) ?? "").startsWith("#"),
    JSON.stringify(minimumPost.split("\n").at(-1) ?? ""),
  );

  /*
    Тело приходит из редактора как HTML. На стену оно должно уйти текстом: ВК разметку в записи
    не понимает, и `&laquo;` или `<b>` показались бы читателю как есть. Строка-отсылка «Читайте
    также» уходит вместе с разметкой: в ВК из неё не остаётся ни ссылки, ни названия, только
    обещание чего-то, чего в посте нет.
  */
  const cleaned = buildPostText({
    title: "Разметка",
    contentHtml:
      '<p>Первый &laquo;абзац&raquo; с <b>жирным</b> и <a href="https://example.com">ссылкой</a>.</p>' +
      "<blockquote><p>Цитата целиком.</p></blockquote>" +
      "<p>Читайте также: другое название</p>" +
      "<p>Хвост материала.</p>",
    slug: "markup",
  });
  check(
    "Тело: разметка снята, абзацы и цитата сохранены, отсылка убрана",
    cleaned.includes("Первый «абзац» с жирным и ссылкой.") &&
      cleaned.includes("„ Цитата целиком.") &&
      cleaned.includes("Хвост материала.") &&
      !cleaned.includes("Читайте также") &&
      !/<\/?[a-z]/i.test(cleaned),
    JSON.stringify(cleaned),
  );

  /*
    Лонгрид длиннее потолка уходит зачином: 4000 символов выбраны не из предела ВК (тот почти
    вчетверо больше), а из читаемости — за десятками абзацев ссылку не находит никто. Обрезка
    обязана встать на границу абзаца или предложения: оборванная на полуслове фраза читается
    как опечатка сайта, а не как решение редакции.
  */
  const longParagraphs = Array.from(
    { length: 40 },
    (_, index) => `<p>Абзац ${index + 1}. ${"Текст предложения. ".repeat(6)}</p>`,
  ).join("");
  const huge = buildPostText({
    title: "Очень длинный материал",
    lead: "Короткий лид длинного материала.",
    contentHtml: longParagraphs,
    categoryName: "Общество",
    slug: "huge",
  });
  const hugeBody = huge.split("\n\n👉 Читать продолжение")[0];
  check(
    "Длинный текст: зовёт на продолжение, а не обрывается",
    huge.includes("👉 Читать продолжение на сайте: http://localhost:3000/news/huge") &&
      !huge.includes("👉 Читать на сайте:") &&
      huge.includes("Абзац 1.") &&
      !huge.includes("Абзац 40."),
    `len=${huge.length}`,
  );
  check(
    "Длинный текст: обрезка встала на конец предложения, а не в середину слова",
    /[.!?…]$/.test(hugeBody.trimEnd()),
    JSON.stringify(hugeBody.trimEnd().slice(-46)),
  );
  check(
    "Длинный текст: предел записи ВК не превышен",
    huge.length <= VK_TEXT_LIMIT && huge.length <= VK_MESSAGE_LIMIT,
    `len=${huge.length} <= ${VK_TEXT_LIMIT} <= ${VK_MESSAGE_LIMIT}`,
  );

  /*
    Хештеги: рубрика первой, дальше ключевые слова материала. Повтор, отличающийся только
    регистром, — тот же тег; число ограничено, иначе под постом получается список тегов, за
    которым не видно самого текста.
  */
  const manyTags = buildPostText({
    title: "Хештеги",
    categoryName: "Здоровье и стиль",
    tagNames: ["Екатеринбург", "екатеринбург", "Город", "Медицина", "Лишний"],
    slug: "tags",
  });
  const tagLine = manyTags.split("\n").at(-1) ?? "";
  check(
    "Хештеги: рубрика первой, регистр не даёт повторов, число ограничено",
    tagLine.startsWith("#Здоровье_и_стиль #Екатеринбург #Город") &&
      !/#екатеринбург/.test(tagLine) &&
      (tagLine.match(/#/g) ?? []).length === VK_MAX_TAGS &&
      !tagLine.includes("#Лишний"),
    JSON.stringify(tagLine),
  );

  // --- attachments --------------------------------------------------------
  check(
    "Вложения: без фото вложений нет",
    buildAttachments(null, "only-link") === "",
    JSON.stringify(buildAttachments(null, "only-link")),
  );
  check(
    "Вложения: с фото — одно фото, без запятой и хвоста",
    buildAttachments("photo276313599_457240126", "both") === "photo276313599_457240126",
    buildAttachments("photo276313599_457240126", "both"),
  );

  // --- the upload answer VK actually sends ---------------------------------
  const okPhoto = JSON.stringify([{ markers_restarted: true, photo: "9bce4ffabc:w", sizes: [] }]);
  check(
    "Ответ загрузки: голый объект с непустым photo принимается",
    // The shape measured on the live endpoint. Reading `.response` here is what made every
    // production post go out without a cover, while this suite stayed green throughout.
    (parseVkUploadResult({ server: 908118, photo: okPhoto, hash: "h_1" })?.server ?? 0) ===
      908118,
    JSON.stringify(parseVkUploadResult({ server: 908118, photo: okPhoto, hash: "h_1" })),
  );
  /*
    The regression this whole change exists for.

    The live endpoint answers two different HTTP 200s: one carrying a non-empty `photo`, and
    one with `photo: ""` — a failed upload reported as success. `saveWallPhoto` refuses the
    empty one with error 100, "photo is undefined", so accepting it here meant the cover was
    uploaded, discarded, and every post went out as bare text. `photo: ""` must read as a
    failure so the caller retries; the retry is what actually recovers, because the empty
    answer was measured on the first attempt run after run.
  */
  check(
    "Ответ загрузки: пустой photo — это провал, а не успех",
    parseVkUploadResult({ server: 908118, photo: "", hash: "h_1" }) === null &&
      parseVkUploadResult({ response: { server: 1, photo: "", hash: "h" } }) === null,
    JSON.stringify(parseVkUploadResult({ server: 908118, photo: "", hash: "h_1" })),
  );
  check(
    "Ответ загрузки: обёрнутый вариант тоже принимается",
    (parseVkUploadResult({ response: { server: 1, photo: okPhoto, hash: "h" } })?.hash ?? "") ===
      "h",
    JSON.stringify(parseVkUploadResult({ response: { server: 1, photo: okPhoto, hash: "h" } })),
  );
  check(
    "Ответ загрузки: мусор и ошибка отвергаются",
    parseVkUploadResult(null) === null &&
      parseVkUploadResult({}) === null &&
      parseVkUploadResult({ server: "not-a-number", photo: okPhoto, hash: "h" }) === null &&
      parseVkUploadResult({ server: 1 }) === null &&
      // The literal production failure: two words of plain text where JSON was expected.
      parseVkUploadResult("Security Breach2") === null &&
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
  const textOnly = await publishArticleToVk({
    title: "Текстовый пост",
    lead: "Лид текстового поста.",
    contentHtml: "<p>Тело текстового поста.</p>",
    categoryName: "Общество",
    tagNames: ["Екатеринбург"],
    slug: "text-post",
  });
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
    The brief asked for the link here too. Measured on the live API: a link-only attachment is
    refused with error 100 ("Violated: link_photo_sizing_rule. No photo given"), while a
    photo-plus-link attachment is accepted and the link is then dropped — the post comes back
    with `attachments: ["photo"]` and nothing else. So the link adds no card, and passing it
    would turn a failed cover upload into a post that never goes out at all.
  */
  check(
    "wall.post: без обложки вложений нет вовсе",
    post?.params.attachments === undefined,
    `attachments=${post?.params.attachments ?? "нет"}`,
  );
  check(
    "wall.post: ссылка на example.com",
    Boolean(post?.params.message?.includes("https://example.com/news/text-post")),
    post?.params.message?.split("\n").find((line) => line.includes("Читать")) ?? "",
  );

  /*
    An empty attachments string is not "no attachments" to VK: it reads as a malformed
    attachment and the post is refused. Omitting the parameter entirely is the only way to
    ask for a plain-text post.
  */
  check(
    "wall.post: пустая строка вложений не отправляется",
    buildAttachments(null, "only-link") === "",
    JSON.stringify(buildAttachments(null, "only-link")),
  );
  check(
    "wall.post: с обложкой вложение — ровно одно фото",
    buildAttachments("ph_9", "both") === "ph_9" && buildAttachments(null, "both") === "",
    `${buildAttachments("ph_9", "both")} / ${buildAttachments(null, "both")}`,
  );
  check(
    "Текст поста на стене: тело, лид, ссылка и хештеги доехали целиком",
    post?.params.message ===
      "Текстовый пост\n\nЛид текстового поста.\n\nТело текстового поста.\n\n" +
        "👉 Читать на сайте: https://example.com/news/text-post\n#Общество #Екатеринбург",
    JSON.stringify(post?.params.message),
  );
  check("Текстовый пост: загрузок не было", uploads.length === 0, `uploads=${uploads.length}`);
  check(
    "wall.post: параметры уходят телом POST, а не строкой запроса",
    post?.httpMethod === "POST" && calls.every((call) => call.httpMethod === "POST"),
    `httpMethod=${post?.httpMethod}`,
  );

  /*
    Длинный пост и транспорт — одна проверка, потому что порознь они и были причиной поломки:
    текст, который не влезает в строку запроса, до ВК не доезжает вообще, и «мы умеем длинные
    посты» остаётся словами. Здесь сообщение проходит через настоящий `wall.post` (заглушку)
    и сравнивается символ в символ.
  */
  ({ calls, uploads } = stubVk({}));
  const longPost = await publishArticleToVk({
    title: "Лонгрид",
    contentHtml: longParagraphs,
    slug: "long-post",
  });
  const longExpected = buildPostText({
    title: "Лонгрид",
    contentHtml: longParagraphs,
    slug: "long-post",
  });
  const longSent = calls.find((call) => call.method === "wall.post")?.params.message ?? "";
  check(
    "Длинный пост доезжает целиком и без потерь",
    longPost.ok === true && longSent === longExpected && longSent.length > 3000,
    `len=${longSent.length}, совпадает=${longSent === longExpected}`,
  );

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
  check(
    "С обложкой: фото действительно прикреплено",
    // The whole point of this suite. `photoId` is the attachment that went out, not a claim
    // that an upload was attempted.
    withCover.photoId === "photo276313599_457240126" && withCover.warning === undefined,
    JSON.stringify(withCover),
  );
  const methods = calls.map((c) => c.method);
  check(
    "С обложкой: полный цикл загрузки",
    methods.includes("photos.getWallUploadServer") &&
      methods.includes("photos.saveWallPhoto") &&
      methods.includes("wall.post"),
    methods.join(" → "),
  );
  check(
    "С обложкой: вложение — только фото",
    // Not `calls.at(-1)`: the read-back after the post is now the last call, so the check has
    // to name the call it means.
    calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments ===
      "photo276313599_457240126",
    `attachments=${calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments}`,
  );
  /*
    `group_id` must be a positive integer, and the sign is not cosmetic.

    Measured live: `photos.getWallUploadServer` answers for either sign and hands back an
    upload address carrying `gid=-241944021`, so nothing warns you at step 1 — and
    `photos.saveWallPhoto` then refuses with error 100, "group_id should be greater or equal
    to 0". A negative value here costs the cover on every post.
  */
  const uploadServerCall = calls.find((c) => c.method === "photos.getWallUploadServer");
  const saveCall = calls.find((c) => c.method === "photos.saveWallPhoto");
  check(
    "С обложкой: group_id положительный на обоих шагах",
    uploadServerCall?.params.group_id === "123456" &&
      saveCall?.params.group_id === "123456" &&
      !String(uploadServerCall?.params.group_id).startsWith("-") &&
      /^\d+$/.test(String(saveCall?.params.group_id)),
    `getWallUploadServer=${uploadServerCall?.params.group_id}, saveWallPhoto=${saveCall?.params.group_id}`,
  );
  check(
    "С обложкой: пустой photo никогда не уходит в saveWallPhoto",
    // The production failure, asserted directly: an empty string there is an error 100 and a
    // coverless post.
    Boolean(saveCall?.params.photo) && saveCall?.params.photo !== "",
    `photo=${String(saveCall?.params.photo).slice(0, 60)}`,
  );

  /*
    The three shapes saveWallPhoto is answered with in the wild, so that a change of VK's
    mood costs a warning rather than a silent coverless post.
  */
  check(
    "id фото собирается из ответа saveWallPhoto",
    vkPhotoAttachmentId([{ id: 457240126, owner_id: 276313599 }]) ===
      "photo276313599_457240126" &&
      vkPhotoAttachmentId({ id: 1, owner_id: 2 }) === "photo2_1" &&
      vkPhotoAttachmentId("photo-3_4") === "photo-3_4" &&
      vkPhotoAttachmentId("-5_6") === "photo-5_6",
    JSON.stringify(
      vkPhotoAttachmentId([{ id: 457240126, owner_id: 276313599 }]),
    ),
  );
  check(
    "id фото: без владельца вложение не строится",
    // A half-built id is worse than none: VK rejects the whole post rather than ignoring it.
    vkPhotoAttachmentId([{ id: 1 }]) === null &&
      vkPhotoAttachmentId([]) === null &&
      vkPhotoAttachmentId(null) === null &&
      vkPhotoAttachmentId({ owner_id: 1 }) === null,
    "null, а не кривая строка",
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
      calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments ===
        "photo276313599_457240126",
    `попыток=${uploads.length}, attachments=${calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments}`,
  );

  /*
    The failure that was actually happening in production, and the one no check covered.

    The upload server answers HTTP 200 with `photo: ""` on the first attempt often enough to
    be the common case. The module used to accept that as a successful upload, hand the empty
    string to `photos.saveWallPhoto`, collect error 100 "photo is undefined" and post the story
    as bare text — with a warning that blamed the cover rather than the reading of the answer.

    The stub now answers the empty shape twice before succeeding, which is the measured
    sequence. A single attempt leaves the post without a cover; the retry is what recovers it.
  */
  ({ calls, uploads } = stubVk({ emptyPhotoTimes: 2 }));
  const emptyFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return emptyFetch(input, init);
  }) as typeof fetch;

  const afterEmpty = await publishArticleToVk({
    title: "Обложка после пустого ответа",
    slug: "empty-photo",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: пустой photo от VK не оставляет пост без фото (повтор)",
    afterEmpty.ok === true &&
      uploads.length === 3 &&
      afterEmpty.photoId === "photo276313599_457240126" &&
      calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments ===
        "photo276313599_457240126",
    `попыток=${uploads.length}, photoId=${afterEmpty.photoId ?? "нет"}, attachments=${calls.filter((c) => c.method === "wall.post").at(-1)?.params.attachments}`,
  );
  check(
    "Обложка: каждая попытка берёт СВЕЖИЙ адрес загрузки",
    // A used upload address carries a one-off hash; re-posting to one answered non-JSON about
    // as often as it answered a photo, so every attempt asks again.
    calls.filter((c) => c.method === "photos.getWallUploadServer").length ===
      uploads.length,
    `адресов=${calls.filter((c) => c.method === "photos.getWallUploadServer").length}, загрузок=${uploads.length}`,
  );
  check(
    "Обложка: пустой photo не попадает в saveWallPhoto ни на одной попытке",
    calls
      .filter((c) => c.method === "photos.saveWallPhoto")
      .every((c) => Boolean(c.params.photo) && c.params.photo !== ""),
    JSON.stringify(calls.filter((c) => c.method === "photos.saveWallPhoto").map((c) => c.params.photo.slice(0, 20))),
  );

  /*
    A community configured by short name instead of a number.

    `vkOwnerId` has always accepted a slug, and the photo pipeline used to pass that same
    string through as `group_id` — which the API cannot use. The number is asked for once via
    groups.getById, which was measured answering for both "241944021" and "eartnews".
  */
  process.env.VK_COMMUNITY_ID = "https://vk.ru/eartnews";
  ({ calls, uploads } = stubVk({}));
  const slugFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return slugFetch(input, init);
  }) as typeof fetch;

  const slugConfigured = await publishArticleToVk({
    title: "Слаг в конфигурации",
    slug: "slug-config",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: сообщество со слагом — числовой group_id уточняется",
    slugConfigured.ok === true &&
      slugConfigured.photoId === "photo276313599_457240126" &&
      calls.some((c) => c.method === "groups.getById") &&
      calls.find((c) => c.method === "photos.getWallUploadServer")?.params.group_id ===
        "241944021",
    `photoId=${slugConfigured.photoId ?? "нет"}, group_id=${
      calls.find((c) => c.method === "photos.getWallUploadServer")?.params.group_id
    }`,
  );
  process.env.VK_COMMUNITY_ID = "-123456";

  /*
    saveWallPhoto succeeds but hands back nothing usable. The post still has to go out, and it
    has to say so — a coverless post with no trace is what the log archaeology had to guess at.
  */
  ({ calls, uploads } = stubVk({ noPhotoId: true }));
  const noIdFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return noIdFetch(input, init);
  }) as typeof fetch;

  const noId = await publishArticleToVk({
    title: "Без id фото",
    slug: "no-photo-id",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: saveWallPhoto без id — пост уходит, но с предупреждением",
    noId.ok === true &&
      noId.photoId === null &&
      calls.at(-1)?.params.attachments === undefined &&
      (noId.warning?.includes("не вернул id") ?? false),
    JSON.stringify(noId),
  );

  /*
    The glitch that turned up on production while this was being verified.

    `wall.post` answered with a post id and the post carried no attachment at all — with a
    photo id that attached fine minutes later when posted by hand. VK reports no error for it,
    so the only way to notice is to read the post back, and the only way to fix it without a
    second copy on the wall is `wall.edit`.
  */
  ({ calls, uploads } = stubVk({ dropAttachmentOnce: true }));
  const dropFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return dropFetch(input, init);
  }) as typeof fetch;

  const repaired = await publishArticleToVk({
    title: "Отброшенное вложение",
    slug: "dropped-attachment",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: молча отброшенное вложение дописывается через wall.edit",
    repaired.ok === true &&
      repaired.warning === undefined &&
      calls.filter((c) => c.method === "wall.edit").length === 1 &&
      calls.find((c) => c.method === "wall.edit")?.params.attachments ===
        "photo276313599_457240126" &&
      // Read twice: once to notice, once to confirm the repair.
      calls.filter((c) => c.method === "wall.getById").length === 2 &&
      calls.filter((c) => c.method === "wall.post").length === 1,
    `edit=${calls.filter((c) => c.method === "wall.edit").length}, постов=${calls.filter((c) => c.method === "wall.post").length}, warning=${repaired.warning ?? "нет"}`,
  );

  /*
    The trap in the repair, and the reason it carries `message`.

    Measured: `wall.edit` given only `attachments` answers 200 and **empties the post's text** —
    a three-line post read back as `text: ""`. VK replaces the fields it is handed, so an
    absent message means an empty one. An earlier version of this repair omitted it and would
    have wiped the body of every post it fixed, silently, with no error anywhere.
  */
  check(
    "Обложка: правка вложения передаёт текст поста, а не стирает его",
    calls.find((c) => c.method === "wall.edit")?.params.message ===
      buildPostText({ title: "Отброшенное вложение", slug: "dropped-attachment" }),
    JSON.stringify(calls.find((c) => c.method === "wall.edit")?.params.message ?? null),
  );

  ({ calls, uploads } = stubVk({ dropAttachmentOnce: true, editFails: true }));
  const editFailFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("example.com/cover")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    }
    return editFailFetch(input, init);
  }) as typeof fetch;

  const repairFailed = await publishArticleToVk({
    title: "Правка не удалась",
    slug: "edit-failed",
    coverImage: "https://example.com/cover.jpg",
  });
  check(
    "Обложка: если дописать не удалось — пост остаётся, но с предупреждением",
    // The post must never be deleted over a missing picture: a coverless post is worth more
    // than no post at all.
    repairFailed.ok === true &&
      calls.every((c) => c.method !== "wall.delete") &&
      (repairFailed.warning?.includes("дописать не удалось") ?? false),
    JSON.stringify(repairFailed),
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
    Degraded, not abandoned: the link is still in the message, so VK shows its own preview
    for it. Only the photo is lost.
  */
  check(
    "Ошибка загрузки обложки: пост без вложений, ссылка в тексте + warning",
    calls.at(-1)?.params.attachments === undefined &&
      Boolean(calls.at(-1)?.params.message?.includes("https://example.com/news/bad-cover")) &&
      typeof uploadFailed.warning === "string",
    `${calls.at(-1)?.params.attachments} / ${uploadFailed.warning ?? "нет warning"}`,
  );

  /*
    Roughly a quarter of all attempts on production answer 504, and they cluster, so the
    attempt count has to be well above the naive one. Giving up early is a coverless post.
  */
  check(
    "Обложка: попыток больше трёх — 504 у ВК идёт примерно в четверти случаев",
    // 3 attempts survived one case of three consecutive 504s and lost the cover.
    UPLOAD_ATTEMPTS >= 5,
    `UPLOAD_ATTEMPTS=${UPLOAD_ATTEMPTS}`,
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

  /*
    What the test button's read-back is built on.

    "The upload answered 200" and "the post carries a picture" are different claims, and only
    the second one is worth showing an editor. These two calls are how the difference is
    measured: `wall.getById` reports what VK actually stored.
  */
  ({ calls } = stubVk({}));
  const attached = await readWallPostAttachments("555");
  check(
    "Чтение поста: вложения читаются из wall.getById",
    Array.isArray(attached) &&
      attached.includes("photo") &&
      calls.find((c) => c.method === "wall.getById")?.params.posts === "-123456_555",
    JSON.stringify(attached),
  );

  ({ calls } = stubVk({ attachmentMissing: true }));
  const bare = await readWallPostAttachments("555");
  check(
    "Чтение поста: пост без фото отличается от поста с фото",
    // An empty array, not null: the post was read and has nothing on it. `null` means the read
    // failed, which is a different thing to tell an editor.
    Array.isArray(bare) && bare.length === 0,
    JSON.stringify(bare),
  );

  ({ calls } = stubVk({}));
  const removed = await deleteWallPost("555");
  check(
    "Удаление тестового поста: wall.delete с отрицательным owner_id",
    removed === true &&
      calls.find((c) => c.method === "wall.delete")?.params.owner_id === "-123456",
    `removed=${removed}`,
  );

  /*
    What the backfill is built on: reading the wall, finding the article in a post, and putting
    a picture on a post that already exists.
  */
  ({ calls, uploads } = stubVk({}));
  const wall = await listWallPosts(100);
  check(
    "Стена: посты читаются вместе с текстом, датой и вложениями",
    wall.length === 2 &&
      wall[0]?.id === "900" &&
      wall[0]?.date === 1000 &&
      wall[0]?.attachments.length === 0 &&
      wall[1]?.attachments[0] === "photo" &&
      calls.find((c) => c.method === "wall.get")?.params.count === "100",
    JSON.stringify(wall.map((p) => [p.id, p.date, p.attachments])),
  );

  check(
    "Стена: ссылка на материал вынимается из текста поста",
    extractArticleSlug("Текст\n\n👉 Читать полностью: https://eartnews.ru/news/medved-naskochil") ===
      "medved-naskochil" &&
      // The host changed during this project's life; the slug is what identifies the story.
      extractArticleSlug("👉 https://old-host.example/news/ai-95-po-144-rublya") ===
        "ai-95-po-144-rublya" &&
      extractArticleSlug("Текст без ссылки") === null &&
      extractArticleSlug("") === null,
    JSON.stringify(extractArticleSlug("https://eartnews.ru/news/one")),
  );

  /*
    The deletion decision, and the check that matters most in this file.

    Seventeen of the twenty-eight posts on the live wall were copies of six stories, created in
    a burst before the claim mechanism existed. Which of a group survives is not a matter of
    taste: deleting the wrong one loses the post that was actually published first, and there is
    no undo — a deleted wall post cannot be restored through the API.
  */
  const wallPost = (id: number, date: number, slug: string | null) => ({
    id: String(id),
    date,
    text: slug ? `Заголовок\n\n👉 Читать полностью: https://eartnews.ru/news/${slug}` : "Пост без ссылки",
    attachments: [] as string[],
  });

  {
    // Newest first, the order `wall.get` returns.
    const plan = planWallDedupe([
      wallPost(104, 400, "repeat"),
      wallPost(103, 300, "other"),
      wallPost(102, 200, "repeat"),
      wallPost(101, 100, "repeat"),
      wallPost(100, 50, null),
    ]);

    check(
      "Дубликаты: из группы остаётся самый ранний",
      plan.remove.map((p) => p.id).join(",") === "104,102" &&
        plan.keep.map((p) => p.id).join(",") === "103,101,100",
      `удаляем [${plan.remove.map((p) => p.id)}], оставляем [${plan.keep.map((p) => p.id)}]`,
    );
    check(
      "Дубликаты: пост без ссылки на материал не удаляется",
      // An older picture post that has nothing to do with the reposter; guessing its identity
      // is how a tool deletes something that was never a duplicate.
      plan.keep.some((p) => p.id === "100") && !plan.remove.some((p) => p.id === "100"),
      JSON.stringify(plan.keep.map((p) => p.id)),
    );
    check(
      "Дубликаты: одинаковые даты разрешаются по id, а не по порядку ответа",
      (() => {
        const forward = planWallDedupe([
          wallPost(10, 500, "tie"),
          wallPost(9, 500, "tie"),
        ]);
        const backward = planWallDedupe([
          wallPost(9, 500, "tie"),
          wallPost(10, 500, "tie"),
        ]);
        return forward.keep[0]?.id === "9" && backward.keep[0]?.id === "9";
      })(),
      "меньший id остаётся",
    );
    check(
      "Дубликаты: без дублей план пуст, и повторный прогон ничего не удаляет",
      planWallDedupe([wallPost(1, 1, "a"), wallPost(2, 2, "b")]).remove.length === 0 &&
        // Idempotent: feeding back only what survived produces nothing to remove.
        planWallDedupe(plan.keep).remove.length === 0,
      JSON.stringify(planWallDedupe(plan.keep).remove.map((p) => p.id)),
    );
  }

  ({ calls } = stubVk({}));
  const edited = await editWallPostAttachments("555", "Текст поста", "photo1_2");
  check(
    "Стена: вложение дописывается с передачей текста",
    edited?.includes("photo") === true &&
      calls.find((c) => c.method === "wall.edit")?.params.message === "Текст поста" &&
      calls.find((c) => c.method === "wall.edit")?.params.attachments === "photo1_2",
    JSON.stringify(calls.find((c) => c.method === "wall.edit")?.params ?? null),
  );

  /*
    The numeric id, in every form an editor might have pasted.

    The photo methods accept only the positive digits, while the config legitimately holds a
    URL, a short name or a signed number. Getting this wrong costs the cover on every post and
    says nothing at step 1 — only `photos.saveWallPhoto` refuses, with "group_id should be
    greater or equal to 0".
  */
  const groupIdFor = (input: string): string | null => {
    const saved = process.env.VK_COMMUNITY_ID;
    process.env.VK_COMMUNITY_ID = input;
    const value = vkCommunityGroupId();
    process.env.VK_COMMUNITY_ID = saved;
    return value;
  };
  check(
    "Числовой id сообщества: минус снимается, слаг даёт null",
    groupIdFor("-241944021") === "241944021" &&
      groupIdFor("241944021") === "241944021" &&
      groupIdFor("https://vk.ru/club241944021") === "241944021" &&
      groupIdFor("public241944021") === "241944021" &&
      // A short name has no digits: it is resolved through groups.getById instead.
      groupIdFor("https://vk.ru/eartnews") === null &&
      groupIdFor("eartnews") === null,
    `-241944021→${groupIdFor("-241944021")}, eartnews→${groupIdFor("eartnews")}`,
  );

  globalThis.fetch = realFetch;
  resetVkRetrySleep();
  if (savedId === undefined) delete process.env.VK_COMMUNITY_ID;
  else process.env.VK_COMMUNITY_ID = savedId;
  if (savedToken === undefined) delete process.env.VK_ACCESS_TOKEN;
  else process.env.VK_ACCESS_TOKEN = savedToken;

  await checkCoverImageReads();
  await checkVerticalPad();

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

/**
 * Узкая вертикаль должна уйти на стену пейзажным кадром, а не «километровой» полоской.

 * Проверяется сам `padVerticalCover`, а не полный путь публикации: он чистый (sharp + память,
 * без сети), и это то место, где решается, будет ли лента сообщества выглядеть опрятно. Пейзаж
 * и умеренный портрет проходят нетронутыми.
 */
async function checkVerticalPad() {
  const { default: sharp } = await import("sharp");

  const vertical = await sharp({
    create: { width: 300, height: 900, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer();

  const padded = await padVerticalCover(vertical.buffer as ArrayBuffer, "image/jpeg");
  const meta = await sharp(Buffer.from(padded.bytes)).metadata();

  check(
    "Обложка: вертикаль 1:3 становится пейзажем 4:3",
    meta.width === 1280 && meta.height === 960 && padded.contentType === "image/jpeg",
    `${meta.width}x${meta.height} (${meta.height! / meta.width!})`,
  );

  const portrait = await sharp({
    create: { width: 400, height: 500, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  const kept = await padVerticalCover(portrait.buffer as ArrayBuffer, "image/jpeg");
  const keptMeta = await sharp(Buffer.from(kept.bytes)).metadata();

  check(
    "Обложка: умеренный портрет 4:5 проходит нетронутым",
    keptMeta.width === 400 && keptMeta.height === 500,
    `${keptMeta.width}x${keptMeta.height}`,
  );

  const broken = new TextEncoder().encode("не картинка").buffer as ArrayBuffer;
  const brokenResult = await padVerticalCover(broken, "image/jpeg");
  check(
    "Обложка: битые байты не роняют публикацию",
    brokenResult.bytes === broken,
    "вернул как есть",
  );
}

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
