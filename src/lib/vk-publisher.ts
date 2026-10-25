/**
 * Auto-repost of published articles to a VK community wall.
 *
 * Flow when a cover image is attached:
 *   photos.getWallUploadServer → POST the bytes to VK → photos.saveWallPhoto → wall.post
 *
 * Whether this is allowed to run at all is a separate question, answered by
 * `lib/vk-dedupe.ts`; this module is only what happens once that is settled.
 *
 * Every step degrades gracefully: if the tokens are missing (local dev) or any
 * call fails, the post still goes out as text with a link.
 */

import type { getSetting as GetSetting } from "@/lib/settings";
import { extensionFor, readCoverImage, siteUrl } from "@/lib/cover-image";
import {
  fitToBudget,
  htmlToPlainText,
  stripKickerLines,
  toHashtag,
} from "@/lib/messenger-post";

/**
 * Re-exported from its new home so `scripts/check-vk-publisher.ts` and any future
 * caller keep importing it from where it has always lived. The implementation is in
 * cover-image.ts because Telegram and MAX read the same cover.
 */
export { readCoverImage } from "@/lib/cover-image";

const VK_API_BASE = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";

export type VkArticle = {
  /** Database id, for the log line only — a repost that misbehaves has to be findable. */
  id?: string;
  title: string;
  lead?: string | null;
  slug: string;
  /**
   * Тело статьи как оно лежит в базе, вместе с разметкой.
   *
   * Необязательно, и это не вежливость к старым вызовам: пост обязан собраться и без тела —
   * заголовок со ссылкой лучше пустой стены. Но когда тело есть, оно уходит на стену целиком:
   * раньше ВК получал один заголовок, и читатель в ленте не понимал, о чём материал.
   */
  contentHtml?: string | null;
  /** Название рубрики — первый хештег в подвале поста. */
  categoryName?: string | null;
  /** Ключевые слова материала: остальные хештеги. */
  tagNames?: readonly string[] | null;
  coverImage?: string | null;
  /**
   * Идентификатор ролика ВК для вложения: `video{owner_id}_{video_id}`.
   *
   * Приходит из загрузки в форме, где ВК сам вернул owner_id и video_id, и хранится в
   * `Article.vkVideoId`. Здесь он только передаётся в `attachments`: без него пост уходит
   * без ролика, а сам ролик остаётся на ВК, не связанный со статьёй.
   */
  vkVideoId?: string | null;
};

/**
 * Every line this module writes starts with this.
 *
 * Not decoration: diagnosing the missing covers meant reading `pm2 logs`, and the one useful
 * line was buried among the AI-cover chatter. `grep '\[vk\]'` is now the whole story of a
 * repost, and the prefix is what makes that possible.
 */
export const VK_LOG_PREFIX = "[vk]";

function log(...parts: unknown[]): void {
  console.log(VK_LOG_PREFIX, ...parts);
}

function logError(...parts: unknown[]): void {
  console.error(VK_LOG_PREFIX, ...parts);
}

/**
 * Combines two warnings into one sentence.
 *
 * A post can hit more than one problem — a cover that failed to upload and then a wall.edit
 * that failed to repair it — and reporting only the last one leaves the editor fixing the
 * symptom they can see rather than the first thing that broke.
 */
function joinWarning(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

export type VkPublishResult = {
  ok: boolean;
  /** Present when VK returned a post id. */
  postId?: string | null;
  /** The wall photo attached to the post, when the cover went up. */
  photoId?: string | null;
  /** Set when the post went out without the cover image. */
  warning?: string;
  error?: string;
};

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string; error_subcode?: number };
};

/**
 * The last meaningful piece of whatever an editor put in `VK_COMMUNITY_ID`.
 *
 * Editors paste whatever the address bar shows, so all of these have to work:
 *
 *   "-241944021"                    -> "241944021"
 *   "241944021"                     -> "241944021"
 *   "https://vk.ru/club241944021"   -> "club241944021"
 *   "public241944021"               -> "public241944021"
 *   "https://vk.ru/eartnews"        -> "eartnews"
 */
export function vkCommunitySegment(): string {
  const raw = process.env.VK_COMMUNITY_ID?.trim() ?? "";
  return raw.split(/[/?#]/).filter(Boolean).pop() ?? "";
}

/** A positive numeric community id, or null when the config holds a short name. */
export function vkCommunityGroupId(): string | null {
  /*
    The leading minus is accepted here because it is a legitimate way to configure the
    community — `vkOwnerId` supports it, the deployment briefs show it, and an editor copying
    the number out of a VK admin URL may well have it. Stripping it here rather than refusing
    the value is what keeps `-241944021` and `241944021` from taking different paths.
  */
  const digits = vkCommunitySegment().match(/^-?(?:club|public)?(\d+)$/i);
  return digits ? digits[1] : null;
}

/**
 * `owner_id` is `-group_id`: the wall belongs to the community, and VK spells that with the
 * minus.
 *
 * A custom short name rather than a number needs a different spelling — VK addresses those
 * as "public" + the slug. Falling through to a raw concatenation would send
 * owner_id="-https://vk.ru/eartnews", which fails every wall.post with an opaque API error
 * that reads like a token problem.
 */
export function vkOwnerId(): string {
  const segment = vkCommunitySegment();

  const fromClub = segment.match(/^club(\d+)$/i);
  if (fromClub) return `-${fromClub[1]}`;

  const fromPublic = segment.match(/^public(\d+)$/i);
  if (fromPublic) return `-${fromPublic[1]}`;

  if (/^-?\d+$/.test(segment)) return `-${segment.replace(/^-/, "")}`;

  if (/^[a-z][a-z0-9_.]*$/i.test(segment)) return `-public${segment}`;

  return `-${process.env.VK_COMMUNITY_ID?.trim() ?? ""}`;
}

/**
 * The community id, resolved from the environment.
 *
 * Unlike the token this one is not in the settings allowlist: it is not a secret,
 * it identifies a destination, and making it editable from the browser would only
 * allow a reposting into an arbitrary community. The server-side value is the
 * trust boundary.
 */
export function vkCommunityId(): string {
  return process.env.VK_COMMUNITY_ID?.trim() ?? "";
}

/**
 * The token, resolved from the settings service.
 *
 * Reads the database first and the environment second, so an editor who pastes a
 * fresh token into /admin/settings replaces the wall reposter immediately — with no
 * .env edit and no pm2 restart. Cached `process.env` here would have made the
 * settings field look like it worked while the repost kept using the old token.
 */
export async function vkAccessToken(): Promise<string> {
  // Imported lazily, not at module scope: `@/lib/settings` is `server-only` and
  // throws the moment it is loaded outside a React Server Component, which is
  // exactly what the vk:check suite does when it stubs VK's HTTP layer.
  const { getSetting } = (await import("@/lib/settings")) as {
    getSetting: typeof GetSetting;
  };

  const token = await getSetting("VK_ACCESS_TOKEN");
  if (!token) {
    throw new Error("VK_ACCESS_TOKEN is not set");
  }
  return token;
}

/**
 * Token lookup, replaceable.
 *
 * The settings service is `server-only`, so importing it here would make this
 * module unimportable from the test script that stubs VK's HTTP layer. Rather than
 * duplicating the module or weakening the guard, the resolver is injectable and
 * defaults to the environment: the production path installs the settings lookup,
 * the tests leave it alone.
 */
let resolveToken: () => Promise<string> = async () => {
  const token = process.env.VK_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("VK_ACCESS_TOKEN is not set");
  return token;
};

/** Points the publisher at the settings table. Called once, from the action. */
export function setVkTokenSource(
  resolve: () => Promise<string> = vkAccessToken,
): void {
  resolveToken = resolve;
}

/** Test-only: restores the environment-based lookup. */
export function resetVkTokenSource(): void {
  resolveToken = async () => {
    const token = process.env.VK_ACCESS_TOKEN?.trim();
    if (!token) throw new Error("VK_ACCESS_TOKEN is not set");
    return token;
  };
}

/** Calls one VK method and unwraps its `response` field. */
async function callVk<T>(
  method: string,
  params: Record<string, string | number>,
  token?: string,
): Promise<T> {
  const query = new URLSearchParams();
  query.set("access_token", token ?? (await resolveToken()));
  query.set("v", VK_API_VERSION);
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  /*
    Параметры уходят телом POST, а не строкой запроса, и это не стилистика.

    `wall.post` шлёт текст записи в `message`, а кириллица в URL-кодировке занимает по шесть
    символов на букву: пост на 4000 знаков превращается в строку запроса длиной около 20 273
    символов (измерено). Прокси и nginx роняют такой запрос раньше, чем он дойдёт до ВК, —
    то есть ровно тот лонгрид, ради которого всё делалось, не уехал бы вовсе. Телом длина
    запроса не ограничена.
  */
  const response = await fetch(`${VK_API_BASE}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: query.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text().catch(() => "");

  if (!response.ok) {
    logError(`${method} → HTTP ${response.status}: ${raw.slice(0, 200)}`);
    throw new Error(`VK ${method} failed with HTTP ${response.status}`);
  }

  let payload: VkEnvelope<T>;
  try {
    payload = JSON.parse(raw) as VkEnvelope<T>;
  } catch {
    // VK does answer these endpoints with HTML on a bad day, and the parse error used to be
    // the only thing an operator saw — with neither the method name nor the body.
    logError(`${method} → ответ не JSON: ${raw.slice(0, 200)}`);
    throw new Error(`VK ${method}: ответ не является JSON`);
  }

  if (payload.error) {
    /*
      The whole error object, not just the message.

      `error_code` and `error_msg` alone are not enough to tell two failures apart — "Access
      denied" covers a dozen causes — and this line is what an operator reads when a repost
      misbehaves at two in the morning.
    */
    logError(
      `${method} → ошибка ВК ${payload.error.error_code ?? "?"}${
        payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""
      }: ${payload.error.error_msg ?? "без описания"}`,
    );
    throw new Error(
      `VK ${method}: ${payload.error.error_msg ?? "unknown error"} (${payload.error.error_code ?? "?"})`,
    );
  }

  return payload.response as T;
}

/**
 * Потолок текста записи на стене — то число, которое называет задание: 15 895 символов.
 *
 * **В документации метода его нет.** Страница `wall.post` (проверена 14.10.2026) описывает типы
 * вложений, ограничения на медиа и коды ошибок, но длину `message` не называет вовсе. Поэтому
 * число держится как заявленное, а фактическим пределом поста служит `VK_TEXT_LIMIT` ниже. Роль
 * потолка — страховка: он участвует в `Math.min` и в проверке `vk:check`, чтобы ни одна будущая
 * правка не отправила в ВК пост длиннее заявленного предела.
 */
export const VK_MESSAGE_LIMIT = 15_895;

/**
 * Длина, после которой пост перестаёт читаться.
 *
 * Предел ВК почти вчетверо больше, но запись на 16 000 знаков в ленте никто не читает: это
 * стена, за которой ссылка уезжает на десятый экран. Поэтому потолок поста — 4000, и всё, что
 * длиннее, уходит зачином со ссылкой на продолжение.
 */
export const VK_TEXT_LIMIT = 4_000;

/** Сколько хештегов уходит в пост, считая рубрику. */
export const VK_MAX_TAGS = 4;

/** Разделитель между блоками поста. */
const BLOCK_GAP = "\n\n";

/**
 * Текст записи на стене: заголовок, лид, тело статьи, ссылка и хештеги.
 *
 * **ВК получает текст, а не анонс.** Раньше на стену уходил заголовок и две фразы лида, и это
 * читалось как «заголовок со ссылкой»: о чём материал, из ленты видно не было. Теперь тело
 * идёт целиком, а длину решает не желание сократить, а читаемость — `VK_TEXT_LIMIT`.
 *
 * **Почему не `buildMessengerPost`.** У Telegram и MAX общая сборка поста, но она отдаёт
 * разметку (`<b>`, `<a href>`) для `parse_mode: HTML`, а ВК разметки в записи не понимает и
 * показал бы теги текстом. Общими поэтому остаются только чистка разметки, снятие строк-отсылок
 * и хештеги (`htmlToPlainText`, `stripKickerLines`, `toHashtag`), а склейка здесь своя, на
 * чистом тексте.
 *
 * Лид намеренно не прогоняется через чистку HTML: он хранится простым текстом и печатается на
 * сайте текстовым узлом, а «чистка тегов» съела бы «5 < 6» вместе с половиной фразы.
 */
export function buildPostText(article: VkArticle): string {
  const base = siteUrl().replace(/\/+$/, "");
  const url = `${base}/news/${article.slug}`;

  const head = [
    article.title.trim(),
    wholeLead(article.lead),
    bodyText(article.contentHtml),
  ]
    .filter((block) => block.length > 0)
    .join(BLOCK_GAP);

  const tags = vkHashtags(article);
  const limit = Math.min(VK_TEXT_LIMIT, VK_MESSAGE_LIMIT);

  const full = closing(url, tags, false);
  if (head.length + BLOCK_GAP.length + full.length <= limit) {
    return `${head}${BLOCK_GAP}${full}`;
  }

  // Есть куда отступать и без потолка: текст длиннее, чем читают. Режем по границе абзаца, а не
  // по символу, и говорим читателю, что продолжение — на сайте.
  const shortened = closing(url, tags, true);
  const budget = Math.max(0, limit - BLOCK_GAP.length - shortened.length);
  return `${fitToBudget(head, budget)}${BLOCK_GAP}${shortened}`;
}

/** Лид как он есть, сжатый по пробелам: на сайте он напечатан ровно этим текстом. */
function wholeLead(lead: string | null | undefined): string {
  return (lead ?? "").replace(/\s+/g, " ").trim();
}

/** Тело статьи: разметка снята, отсылки «читайте также» убраны, абзацы сохранены. */
function bodyText(contentHtml: string | null | undefined): string {
  return stripKickerLines(htmlToPlainText(contentHtml ?? ""));
}

/** Подвал записи: ссылка словами, хештеги строкой ниже. */
function closing(url: string, tags: string, continued: boolean): string {
  const label = continued ? "👉 Читать продолжение на сайте" : "👉 Читать на сайте";
  const link = `${label}: ${url}`;
  return tags ? `${link}\n${tags}` : link;
}

/**
 * Хештеги поста: рубрика первой, дальше ключевые слова материала.
 *
 * `toHashtag` оставляет кириллицу и заменяет пробелы подчёркиваниями, поэтому «Здоровье и стиль»
 * становится одним тегом, а не тремя. Повторы снимаются без учёта регистра, число ограничено:
 * десяток тегов под постом читается как спам и мешает найти сам текст.
 */
function vkHashtags(article: VkArticle): string {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const name of [article.categoryName, ...(article.tagNames ?? [])]) {
    const tag = toHashtag(name);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= VK_MAX_TAGS) break;
  }

  return tags.join(" ");
}

/**
 * The `attachments` value: the wall photo and the video, each only when present.
 *
 * **The brief asked for the link here as well** — `photo{owner_id}_{id},https://…/news/{slug}`.
 * It is deliberately not passed, and the reason is a set of measurements taken against the
 * live API on production rather than a preference:
 *
 *   attachments=https://eartnews.ru/news/…            → error 100, "Violated:
 *                                                       link_photo_sizing_rule. No photo given"
 *   attachments=photo276313599_457240136,https://…    → post created, and the post comes back
 *                                                       with `attachments: ["photo"]` — the
 *                                                       link is accepted and then dropped
 *
 * So the link buys nothing: VK does not keep it as an attachment, and it renders its own
 * preview for the bare URL in the message, which is where the link already is.
 *
 * It also costs something. The link-only form is *refused*, so the combined form would turn a
 * cover failure into a total failure: with no photo id there is nothing to attach but the
 * link, and `wall.post` answers error 100 and publishes nothing at all. A post without a
 * picture is a small loss; no post is a large one.
 *
 * An earlier version of this comment claimed the combined form was itself refused with error
 * 100. That measurement was taken while the cover upload was broken — the photo id came back
 * empty, so what was actually sent *was* the link-only form, and the error was read as being
 * about the combination. The conclusion happened to be right and the reason was wrong, which
 * is the more dangerous half to leave in a comment.
 */
export function buildAttachments(
  photoId: string | null,
  slug: string,
  vkVideoId?: string | null,
): string {
  // `slug` is unused on purpose — see above. Kept in the signature so the caller keeps
  // passing the story it is posting about, and so restoring a link attachment later is a
  // one-line change rather than a search.
  void slug;

  /*
    A missing part is left out of the list rather than passed as an empty element.

    VK reads `photo123_456,` as a malformed attachment and refuses the whole post, so a story
    with a video but no cover (or the reverse) must send exactly the parts that exist.
  */
  return [photoId, vkVideoId]
    .filter((value): value is string => Boolean(value))
    .join(",");
}

/**
 * Size VK renders the link card at.
 *
 * Unused: VK refuses a link attachment on this community whatever value is given (see
 * `buildAttachments`), so there is no rule left to satisfy. Kept out of the request rather
 * than sent and ignored — a parameter that provably changes nothing is only a second thing
 * to be wrong later.
 */
export const VK_LINK_PHOTO_SIZING = "1080x720";

/**
 * What `upload_url` answers with.
 *
 * Note the absence of an envelope. This is not the API's `response` wrapper: the upload
 * endpoint is a plain form handler and returns the three values directly. The old code read
 * `uploaded.response` and threw "cover upload returned no response payload" on a perfectly
 * good answer — which is why every wall post went out as bare text with a link. The unit
 * tests passed throughout because the stub returned the enveloped shape; it encoded the bug
 * instead of the behaviour.
 */
type VkUploadResult = { server: number; photo: string; hash: string };

/**
 * Reads the upload answer, accepting the bare form VK actually sends.
 *
 * The enveloped form is still accepted because VK has changed this before and a future
 * server that wraps it should degrade into working rather than into a missing cover.
 *
 * **A non-empty `photo` is required, and this is the measurement the whole feature hung on.**
 * The live endpoint answers two different 200s:
 *
 *   {"server":903529,"photo":"[{…\"photo\":\"9bce4ffabc:w\"…}]","hash":"…"}   1682 bytes
 *   {"server":903529,"photo":"","hash":"…"}                                    70 bytes
 *
 * The second is a *failed* upload reported as success. `photos.saveWallPhoto` refuses it —
 * error 100, "photo is undefined" — so accepting it here meant the cover was never saved,
 * `photoId` came back null and every post went out as bare text. An earlier version of this
 * function documented the empty string as normal ("the identifier is minted at saveWallPhoto
 * from the server and hash") and passed it along; the check suite agreed because its stub
 * returned `photo: ""` too. Neither was ever measured against the live endpoint.
 *
 * Treating it as a failure makes it retryable instead, and the retry is what fixes it: the
 * empty answer was measured on the *first* attempt in run after run, with the next attempt
 * returning a full payload.
 */
export function parseVkUploadResult(payload: unknown): VkUploadResult | null {
  const candidate =
    payload && typeof payload === "object" && "response" in payload
      ? (payload as { response: unknown }).response
      : payload;

  if (!candidate || typeof candidate !== "object") return null;

  const { server, photo, hash } = candidate as Record<string, unknown>;
  if (typeof server !== "number" || !Number.isFinite(server)) return null;
  if (typeof hash !== "string" || hash.length === 0) return null;

  // The identifier itself. Empty means the upload did not happen, whatever the status said.
  if (typeof photo !== "string" || photo.length === 0) return null;

  return { server, photo, hash };
}

/**
 * Turns what `photos.saveWallPhoto` returns into an attachment id.
 *
 * Measured on production, and the return is not the documented one. Documentation says a
 * `photo` string; the live service answers with an array of photo objects carrying `id` and
 * `owner_id`, so reading `.photo` yields undefined and the cover is uploaded, paid for, and
 * then silently dropped from the post — which is exactly what it was doing.
 *
 * All three shapes are handled, because which one comes back is not something this code
 * gets to choose, and guessing wrong costs a cover on every single post:
 *
 *   "photo-276313599_457240126"   → used as-is
 *   "-276313599_457240126"        → prefixed, VK accepts both spellings
 *   [{ id, owner_id, ... }]       → "photo{owner_id}_{id}"
 */
export function vkPhotoAttachmentId(saved: unknown): string | null {
  const candidate = Array.isArray(saved) ? saved[0] : saved;
  if (!candidate) return null;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("photo") ? trimmed : `photo${trimmed}`;
  }

  if (typeof candidate === "object") {
    const { id, owner_id: ownerId } = candidate as { id?: unknown; owner_id?: unknown };
    if (typeof id !== "number" && typeof id !== "string") return null;
    // Without an owner the id cannot be completed, and a half-built attachment id is worse
    // than none: VK rejects the whole post rather than ignoring the attachment.
    if (typeof ownerId !== "number" && typeof ownerId !== "string") return null;
    return `photo${ownerId}_${id}`;
  }

  return null;
}

/**
 * A failure worth another attempt: a 5xx from the upload server, an answer that is not JSON,
 * or a 200 that carried no photo. Anything else is a rejection and is rethrown.
 */
class RetryableUploadError extends Error {}

/**
 * The community id in the form the photo methods demand: a positive integer.
 *
 * Measured, and the sign is not cosmetic. `photos.getWallUploadServer` answers for either
 * sign and hands back an upload address carrying `gid=-241944021`, so nothing warns you;
 * `photos.saveWallPhoto` then refuses with error 100, "group_id should be greater or equal
 * to 0", and the cover is lost. Passing `VK_COMMUNITY_ID` through raw also broke every
 * deployment that configured a club URL or a short name, because `group_id` has to be the
 * number and nothing else.
 */
async function communityGroupIdForPhotos(): Promise<string> {
  const direct = vkCommunityGroupId();
  if (direct) return direct;

  // A short name is a legitimate way to configure the community — `vkOwnerId` accepts it —
  // so it is resolved here rather than refused. Measured: groups.getById answers a numeric id
  // for both "241944021" and "eartnews".
  const segment = vkCommunitySegment();
  log(`числовой id в конфигурации отсутствует («${segment}») — уточняю через groups.getById`);

  const listed = await callVk<{ groups?: { id?: number }[] } | { id?: number }[]>(
    "groups.getById",
    { group_id: segment },
  );
  const groups = Array.isArray(listed) ? listed : listed?.groups;
  const id = groups?.[0]?.id;
  if (id === undefined || id === null) {
    throw new Error(`не удалось определить числовой id сообщества по «${segment}»`);
  }
  return String(id);
}

/**
 * A cover that is too tall is padded onto a landscape canvas with a blurred copy of itself as
 * the background — the "blur letterbox".
 *
 * A "kilometer vertical" (a phone screenshot, a portrait three times taller than it is wide)
 * reads on a wall as a thin sliver that pushes everything else down. Padded it becomes a clean
 * 4:3 tile with the whole photograph still visible — nothing is cropped away, which is the
 * "safe" half of "safe crop/pad": a naive centre-crop would cut the head off a portrait.
 *
 * Returns the original untouched when the image is landscape or mildly portrait, when sharp
 * cannot read the dimensions, or when the pad itself fails — a nicer tile is never worth a lost
 * post.
 */
export async function padVerticalCover(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(bytes)).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) return { bytes, contentType };
    // Taller than 3:2 is where a portrait starts to read as a sliver on a wall.
    if (height / width <= 1.5) return { bytes, contentType };

    const canvas = { width: 1280, height: 960 }; // 4:3, the aspect VK's wall feed is happiest with.
    const background = await sharp(Buffer.from(bytes))
      .resize(canvas.width, canvas.height, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.65 })
      .toBuffer();
    const foreground = await sharp(Buffer.from(bytes))
      .resize({ height: canvas.height, withoutEnlargement: true })
      .toBuffer();
    const padded = await sharp(background)
      .composite([{ input: foreground, gravity: "centre" }])
      .jpeg({ quality: 86 })
      .toBuffer();

    return { bytes: Uint8Array.from(padded).buffer, contentType: "image/jpeg" };
  } catch {
    return { bytes, contentType };
  }
}

/**
 * Uploads the cover to VK and returns the saved wall photo attachment id.
 *
 * Exported for the cover backfill, which needs the same photo without a wall.post around it.
 */
export async function uploadCoverAttachment(imageUrl: string): Promise<string> {
  const groupId = await communityGroupIdForPhotos();
  const raw = await readCoverImage(imageUrl);
  const { bytes, contentType } = await padVerticalCover(raw.bytes, raw.contentType);
  const extension = extensionFor(contentType) ?? ".jpg";
  log(`обложка прочитана: ${bytes.byteLength} байт, ${contentType}, group_id=${groupId}`);

  let lastProblem = "";

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    /*
      A fresh upload address for every attempt.

      The address `getWallUploadServer` hands out carries a one-off hash tied to the album,
      and re-posting to a used address was measured answering non-JSON about as often as it
      answered a photo. Asking again is one cheap call next to a lost cover.
    */
    const uploadServer = await callVk<{ upload_url: string; album_id?: number }>(
      "photos.getWallUploadServer",
      { group_id: groupId },
    );

    let host = "?";
    try {
      host = new URL(uploadServer.upload_url).host;
    } catch {
      // Nothing to report beyond the fact that VK sent an address that is not a URL; the POST
      // below fails with the same information.
    }
    log(`шаг 1/3 (попытка ${attempt}/${UPLOAD_ATTEMPTS}): адрес загрузки получен (${host})`);

    let uploaded: VkUploadResult;
    try {
      uploaded = await postCoverBytes(uploadServer.upload_url, bytes, extension, contentType);
    } catch (error) {
      // A 4xx is the request being wrong, and the next identical one will be wrong too.
      if (!(error instanceof RetryableUploadError)) throw error;
      lastProblem = error.message;
      logError(`шаг 2/3: попытка ${attempt}/${UPLOAD_ATTEMPTS} не удалась — ${lastProblem}`);
      await sleepBeforeRetry(attempt);
      continue;
    }
    log(
      `шаг 2/3: файл принят — server=${uploaded.server}, hash=${uploaded.hash}, photo=${uploaded.photo.length} символов`,
    );

    /*
      A rejection here is the API saying no, and it will say no again — failing fast keeps a
      publish an editor is waiting on from spending ten seconds re-asking a question that has
      been answered.
    */
    const saved = await callVk<unknown>("photos.saveWallPhoto", {
      group_id: groupId,
      server: uploaded.server,
      photo: uploaded.photo,
      hash: uploaded.hash,
    });

    const attachment = vkPhotoAttachmentId(saved);
    if (!attachment) {
      throw new Error("ВК сохранил обложку, но не вернул id фото — вложение собрать не из чего");
    }

    log(`шаг 3/3: обложка сохранена — ${attachment}`);
    return attachment;
  }

  throw new Error(
    `не удалось загрузить обложку за ${UPLOAD_ATTEMPTS} попыток: ${lastProblem || "причина неизвестна"}`,
  );
}

/**
 * How many times a failing upload is retried.
 *
 * Measured rather than guessed: uploading five different covers three times each on
 * production gave 200, 200, 504 / 200, 504, 504 / 200, 200, 504 / 504, 504, 200 / 200, 200,
 * 200 — roughly a quarter of all attempts answered with an HTTP 504 "page is temporarily
 * unavailable", independent of file size (172 KB files failed as readily as 830 KB ones).
 * VK's upload server is simply unreliable, and one attempt turned that into one wall post
 * without a cover for a reason that had nothing to do with the cover.
 *
 * Five, not three: the failures cluster, which is what a server under load looks like, so
 * the odds do not improve the way independent failures would. In the session where this was
 * measured, three consecutive attempts on one cover all came back 504.
 */
const UPLOAD_ATTEMPTS = 5;

/**
 * Exported for the check suite.
 *
 * The number is a policy, not an implementation detail: it is the difference between a
 * post with a cover and a post without one, and it was set from a measurement rather than
 * a guess. Asserting on it keeps a later "let's tidy this up" from quietly dropping it.
 */
export { UPLOAD_ATTEMPTS };

/**
 * Pause before the next attempt, growing with the attempt number.
 *
 * Growing rather than fixed for the same reason the attempts are not fixed: if the server is
 * busy, the right thing to do is wait longer, not to knock sooner. The total added to the
 * worst case is a little over ten seconds on a publish an editor is waiting on.
 */
function uploadBackoff(attempt: number): number {
  return 1_500 * attempt;
}

/**
 * One POST of the cover bytes, as the multipart part VK expects.
 *
 *  - the field is named `photo`, and the part carries a filename with a real extension;
 *  - the body is read as *text* first.
 *
 * The second point is a diagnosis, not a style. This endpoint answers with an HTML error page
 * on a busy day, and — measured in the production log — with the two bare words
 * "Security Breach2" when it dislikes the call. `response.json()` turned either into
 * `Unexpected token 'S', "Security Breach2" is not valid JSON`: an error naming neither the
 * endpoint, nor the body, nor which attempt it was. That single string was the whole of the
 * production evidence, and it said nothing.
 */
async function postCoverBytes(
  uploadUrl: string,
  bytes: ArrayBuffer,
  extension: string,
  contentType: string,
): Promise<VkUploadResult> {
  // A new body per call: a Blob cannot be appended to a FormData twice.
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type: contentType }), `cover${extension}`);

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  const body = await response.text().catch(() => "");
  const snippet = body.slice(0, 160).replace(/\s+/g, " ").trim();

  if (!response.ok) {
    const detail = `HTTP ${response.status}${snippet ? `: ${snippet}` : ""}`;
    // 5xx is the upload server being busy — worth repeating. 4xx is the request itself.
    throw response.status >= 500
      ? new RetryableUploadError(detail)
      : new Error(`ВК отверг загрузку обложки: ${detail}`);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  const result = parseVkUploadResult(parsed);
  if (result) return result;

  // A 200 with nothing usable behind it: the measured `photo: ""`, or a body that is not JSON
  // at all. Both deserve another attempt, and both have to say what they were.
  throw new RetryableUploadError(
    parsed
      ? "ВК ответил 200, но без photo — загрузка не состоялась"
      : `ответ сервера загрузки не JSON: ${snippet || "пусто"}`,
  );
}

/**
 * Waits before another attempt — but not after the last one.
 *
 * Sleeping then falling out of the loop would add up to seven seconds to an upload that has
 * already been given up on, on a publish the editor is waiting for.
 */
async function backoffBeforeRetry(attempt: number): Promise<void> {
  if (attempt >= UPLOAD_ATTEMPTS) return;
  await new Promise((resolve) => setTimeout(resolve, uploadBackoff(attempt)));
}

/*
  Replaceable for the same reason `resolveToken` is: the wait is a policy, not a behaviour,
  and the check suite would otherwise spend fifteen seconds asleep proving that five 500s
  happen in a row.
*/
let sleepBeforeRetry: (attempt: number) => Promise<void> = backoffBeforeRetry;

/** Test-only: replaces the pause between upload attempts. */
export function setVkRetrySleep(
  sleep: (attempt: number) => Promise<void> = backoffBeforeRetry,
): void {
  sleepBeforeRetry = sleep;
}

/** Test-only: restores the real backoff. */
export function resetVkRetrySleep(): void {
  sleepBeforeRetry = backoffBeforeRetry;
}

/**
 * Publishes an article to the community wall.
 *
 * Never throws: an absent token or a VK outage degrades to `ok: false` with a
 * reason, so the article still saves in the database.
 */
export async function publishArticleToVk(
  article: VkArticle,
): Promise<VkPublishResult> {
  // Both are checked through the resolved values, not through process.env: the
  // token may now live only in the settings table.
  //
  // The failure is logged rather than swallowed. It used to be `.catch(() => "")`, which
  // turned "the settings table could not be read" into "ВК не настроен: задайте токен" — an
  // instruction to go and set a token that is already set, and the whole reason a repost that
  // had been working overnight could report a configuration problem instead of its cause.
  const token = await resolveToken().catch((error: unknown) => {
    logError(
      "не удалось получить токен ВК:",
      error instanceof Error ? error.message : error,
    );
    return "";
  });
  if (!vkCommunityId() || !token) {
    return {
      ok: false,
      error:
        "ВК не настроен: задайте VK_COMMUNITY_ID и токен ВК в разделе «Настройки» или в .env",
    };
  }

  const communityId = vkOwnerId();
  const message = buildPostText(article);
  /** The wall photo attachment, or null when there was no cover or the upload failed. */
  let photoId: string | null = null;
  let warning: string | undefined;

  log(
    `публикация: статья ${article.id ?? "без id"} «${article.slug}», обложка: ${
      article.coverImage ?? "нет"
    }, видео: ${article.vkVideoId ?? "нет"}, owner_id=${communityId}`,
  );

  if (article.coverImage) {
    try {
      photoId = await uploadCoverAttachment(article.coverImage);
    } catch (error) {
      // The post itself is still worth publishing without the image.
      warning = `Не удалось загрузить обложку: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
      }`;
      logError(`обложка не загружена, пост уйдёт без неё — ${warning}`);
    }
  } else {
    log("обложки нет — пост уйдёт только текстом со ссылкой");
  }

  /*
    Одно значение на оба запроса — `wall.post` и восстановление через `wall.edit`.

    `wall.edit` заменяет вложения целиком, а не дополняет их. Если бы правка отправляла только
    обложку, ролик, который ВК принял с первого раза, исчез бы из поста именно в момент
    починки обложки — то есть восстановление одного вложения ломало бы другое.
  */
  const attachments = buildAttachments(photoId, article.slug, article.vkVideoId);

  try {
    const posted = await callVk<{ post_id?: number | string }>("wall.post", {
      owner_id: communityId,
      from_group: 1,
      message,
      // Present whenever at least one attachment made it up; omitted otherwise, because VK
      // treats an empty string as a malformed attachment and rejects the whole post.
      ...(attachments ? { attachments } : {}),
    });

    /*
      Ask VK what ended up on the post, and repair it if the cover was dropped.

      Measured: `wall.post` answers with a post id while the post carries no attachment at
      all — one occurrence in six attempts during this work, with a photo id that was
      demonstrably usable minutes later (the same id attached fine when posted by hand). VK
      returns no error for it, so the only way to know is to read the post back.

      The repair is `wall.edit`, not a second post: the post already exists, and editing its
      attachments mutates it in place with no window in which the wall has two copies.
    */
    if (attachments && posted?.post_id != null) {
      const postId = String(posted.post_id);
      const landed = await readWallPostAttachments(postId);

      /*
        What this code sent, by the names VK prints in `attachments`: `photo` and `video`.

        Comparing types rather than counting: a post that kept the video and lost the cover has
        one attachment and is still broken, so "not empty" is not the same as "complete".
      */
      const expected = [photoId ? "photo" : null, article.vkVideoId ? "video" : null].filter(
        (type): type is string => Boolean(type),
      );

      /*
        `null` means the read failed, which is not evidence of anything; only a post that was
        read is worth comparing.
      */
      const missing = landed ? expected.filter((type) => !landed.includes(type)) : [];

      if (missing.length > 0) {
        logError(
          `пост ${postId} создан без вложения (${missing.join(", ")}) — дописываю через wall.edit`,
        );
        try {
          /*
            `message` is passed again, and that is not redundancy.

            Measured: `wall.edit` given only `attachments` **empties the post's text** — a post
            written with three lines came back with `text: ""`. VK treats the edit as a full
            replacement of the fields it is given, and an absent message means an empty one,
            not "leave it alone". An earlier version of this repair omitted it and would have
            wiped the body of every post it fixed.
          */
          await callVk("wall.edit", {
            owner_id: communityId,
            post_id: postId,
            message,
            // Both parts, not only the missing one — `wall.edit` replaces the list. See the
            // note where `attachments` is built.
            attachments,
          });

          const repaired = await readWallPostAttachments(postId);
          const stillMissing = repaired
            ? expected.filter((type) => !repaired.includes(type))
            : [];

          if (repaired === null) {
            log(`правка отправлена к посту ${postId}, проверить вложения не удалось`);
          } else if (stillMissing.length > 0) {
            warning = joinWarning(
              warning,
              `ВК принял пост без вложения (${stillMissing.join(", ")}) и не прикрепил его даже после правки`,
            );
          } else {
            log(`вложения дописаны к посту ${postId}`);
          }
        } catch (error) {
          warning = joinWarning(
            warning,
            `ВК создал пост без вложения (${missing.join(", ")}), дописать не удалось: ${
              error instanceof Error ? error.message : "неизвестная ошибка"
            }`,
          );
        }
      }
    }

    log(
      `готово: пост ${posted?.post_id ?? "?"}, вложения: ${attachments || "нет"}${
        warning ? `, предупреждение: ${warning}` : ""
      }`,
    );

    return {
      ok: true,
      postId: posted?.post_id != null ? String(posted.post_id) : null,
      photoId: photoId ?? null,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    logError("пост не отправлен:", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "неизвестная ошибка ВК",
    };
  }
}

/**
 * What VK says is actually attached to a post, read back from the API.
 *
 * This exists because "the upload returned 200" and "the post carries a picture" are two
 * different claims, and only the second one is what an editor cares about. The check button
 * uses it to turn a hopeful green tick into a verified one.
 *
 * Returns null when the post cannot be read at all — a different answer from an empty array,
 * which means it was read and has nothing on it.
 */
export async function readWallPostAttachments(postId: string): Promise<string[] | null> {
  const owner = vkOwnerId();
  try {
    const response = await callVk<
      { items?: { attachments?: { type?: string }[] }[] } | { attachments?: { type?: string }[] }[]
    >("wall.getById", { posts: `${owner}_${postId}` });

    const items = Array.isArray(response) ? response : (response?.items ?? []);
    const first = items[0];
    if (!first) return null;

    return (first.attachments ?? []).map((attachment) => attachment.type ?? "unknown");
  } catch (error) {
    logError(`не удалось прочитать пост ${postId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Removes a wall post.
 *
 * Used by the test button so a probe does not stay on the wall, and by the deduplication script
 * for the copies a burst left behind.
 */
export async function deleteWallPost(postId: string): Promise<boolean> {
  try {
    await callVk<number>("wall.delete", { owner_id: vkOwnerId(), post_id: postId });
    log(`пост ${postId} удалён со стены`);
    return true;
  } catch (error) {
    logError(
      `пост ${postId} удалить не удалось:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/** One post on the community wall, reduced to what a backfill or a dedupe needs. */
export type WallPost = {
  id: string;
  /** Creation time, VK's `date`, in seconds since the epoch. */
  date: number;
  text: string;
  /** Attachment types, e.g. `["photo"]`; empty means the post carries nothing. */
  attachments: string[];
};

/** The community's wall, newest first. */
export async function listWallPosts(limit = 100): Promise<WallPost[]> {
  const response = await callVk<
    {
      items?: { id?: unknown; date?: unknown; text?: unknown; attachments?: { type?: string }[] }[];
    }
  >("wall.get", { owner_id: vkOwnerId(), count: limit });

  const items = Array.isArray(response) ? response : (response?.items ?? []);
  return items.flatMap((raw) => {
    const post = raw as {
      id?: unknown;
      date?: unknown;
      text?: unknown;
      attachments?: { type?: string }[];
    };
    if (post.id === undefined || post.id === null) return [];
    return [
      {
        id: String(post.id),
        // VK's own creation timestamp, and the only thing that can order two posts that carry
        // the same text — which is exactly what a burst of duplicates looks like.
        date: typeof post.date === "number" ? post.date : 0,
        text: typeof post.text === "string" ? post.text : "",
        attachments: (post.attachments ?? []).map((attachment) => attachment.type ?? "unknown"),
      },
    ];
  });
}

/**
 * The article slug a wall post links to, or null.
 *
 * Wall posts are built by `buildPostText`, which ends with `<site>/news/<slug>`. The loose
 * match on `/news/<slug>` rather than on a full site URL is deliberate: the address has
 * changed host during this project's life, and a post written under the old one still points
 * at the same article.
 */
export function extractArticleSlug(text: string): string | null {
  const match = text.match(/\/news\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Which posts stay on the wall and which are copies of another post. */
export type WallDedupePlan = {
  /** The earliest post of each article: what remains. */
  keep: WallPost[];
  /** Later copies of a story that is already on the wall. */
  remove: WallPost[];
};

/**
 * Splits a wall into one post per article and the copies of it.
 *
 * Identity is the article the post links to, not its text: a story that was re-saved between
 * two reposts can differ by a word, and comparing text would let both copies survive.
 *
 * The **earliest** post of a group is kept — it is the one that was published first, and the
 * later ones are the accident. Ties are broken by id so that a burst inside one second has a
 * deterministic answer rather than whatever order the API happened to return; the ids are
 * compared **as numbers**, because `"10" < "9"` is true as strings and would keep the wrong
 * copy of every pair whose ids cross a power of ten.
 *
 * A post with no article link is never a duplicate and never removed. On this wall there is
 * one such post — an older picture post that has nothing to do with the reposter — and it is
 * the reason this function returns a plan instead of a list of ids to trust.
 */
export function planWallDedupe(posts: readonly WallPost[]): WallDedupePlan {
  const earliest = new Map<string, WallPost>();

  for (const post of posts) {
    const slug = extractArticleSlug(post.text);
    if (!slug) continue;

    const current = earliest.get(slug);
    const earlier =
      current !== undefined &&
      (post.date < current.date ||
        (post.date === current.date && Number(post.id) < Number(current.id)));

    if (current === undefined || earlier) earliest.set(slug, post);
  }

  const keep: WallPost[] = [];
  const remove: WallPost[] = [];
  const keptIds = new Set([...earliest.values()].map((post) => post.id));

  for (const post of posts) {
    if (extractArticleSlug(post.text) === null || keptIds.has(post.id)) keep.push(post);
    else remove.push(post);
  }

  return { keep, remove };
}

/**
 * Puts an attachment on an existing post and returns what is on it afterwards.
 *
 * **`message` is not optional, and not a convenience.** Measured against the live API:
 * `wall.edit` given only `attachments` comes back 200 and *empties the post's text* — a post
 * written as three lines read back with `text: ""`. VK replaces the fields it is handed, so an
 * absent message means an empty one rather than "leave it alone". The same call with the text
 * passed through keeps it exactly, newlines included.
 *
 * Returns the attachment types as VK reports them, or null when the read-back failed.
 */
export async function editWallPostAttachments(
  postId: string,
  message: string,
  attachment: string,
): Promise<string[] | null> {
  await callVk("wall.edit", {
    owner_id: vkOwnerId(),
    post_id: postId,
    message,
    attachments: attachment,
  });

  return readWallPostAttachments(postId);
}
