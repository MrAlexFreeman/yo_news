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
  coverImage?: string | null;
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
  const url = new URL(`${VK_API_BASE}/${method}`);
  url.searchParams.set("access_token", token ?? (await resolveToken()));
  url.searchParams.set("v", VK_API_VERSION);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
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
 * Title, blank line, the first sentences of the lead, then the link.
 *
 * The lead is cut to two sentences rather than pasted whole. A wall post is a teaser: the
 * lead is written for the site, where the reader has the rest of the story one click away,
 * and a five-sentence lead on a wall pushes the link below the fold of a phone screen —
 * where VK truncates the post with an ellipsis and the reader never sees the URL at all.
 */
export function buildPostText(article: VkArticle): string {
  const link = `${siteUrl()}/news/${article.slug}`;
  const lead = leadSummary(article.lead);

  return lead
    ? `${article.title}\n\n${lead}\n\n👉 Читать полностью: ${link}`
    : `${article.title}\n\n👉 Читать полностью: ${link}`;
}

/** How much of the lead a wall post carries. */
export const VK_LEAD_SENTENCES = 2;

/** Ceiling on the lead in characters, so a single very long sentence cannot take over. */
export const VK_LEAD_MAX = 320;

/**
 * The first sentences of the lead.
 *
 * Cuts on sentence-ending punctuation, and stops mid-word if the ceiling lands inside one
 * — an ellipsis is honest about that, where a hard slice would end on a truncated stem that
 * reads as a typo.
 *
 * Returns "" rather than a fragment when there is nothing usable, so `buildPostText` can
 * leave the paragraph out instead of posting an empty gap.
 */
export function leadSummary(lead: string | null | undefined): string {
  const trimmed = (lead ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const sentences = trimmed.split(/(?<=[.!?…])\s+/u).filter(Boolean);
  let summary = sentences.slice(0, VK_LEAD_SENTENCES).join(" ").trim();

  if (summary.length > VK_LEAD_MAX) {
    const cut = summary.slice(0, VK_LEAD_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    summary = `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }

  return summary;
}

/**
 * The `attachments` value: the wall photo, or nothing.
 *
 * **The brief asked for the link here as well** — `photo{owner_id}_{id},https://…/news/{slug}`.
 * That cannot be done on this community, and it is worth recording why rather than quietly
 * dropping the second half. Measured against the live API on production, every form of a
 * link attachment is refused with error 100:
 *
 *   attachments=https://eartnews.ru/news/probe                                  → 100
 *   … + link_photo_sizing_rule=1080x720                                          → 100
 *   … + link_photo_sizing_rule=1312x807                                          → 100
 *   … + link_photo_sizing_rule=2048x1366                                         → 100
 *   photo + link, with and without every sizing rule                             → 100
 *
 * all on API versions 5.92, 5.131, 5.197 and 5.199, so it is not a version that gained or
 * lost the feature. The error reads "Violated: link_photo_sizing_rule. No photo given",
 * which sends you looking for a missing photo that was in fact supplied.
 *
 * The link therefore stays in the message, where VK renders its own preview for a bare URL
 * — verified on the wall after a real post, see the check below. Passing it as an attachment
 * would not add a card; it would stop the post going out at all.
 */
export function buildAttachments(photoId: string | null, slug: string): string {
  // `slug` is unused on purpose — see above. Kept in the signature so the caller keeps
  // passing the story it is posting about, and so restoring a link attachment later is a
  // one-line change rather than a search.
  void slug;
  return photoId ?? "";
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

/** Uploads the cover to VK and returns the saved wall photo attachment id. */
async function uploadCoverImage(imageUrl: string): Promise<string> {
  const groupId = await communityGroupIdForPhotos();
  const { bytes, contentType } = await readCoverImage(imageUrl);
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
    }, owner_id=${communityId}`,
  );

  if (article.coverImage) {
    try {
      photoId = await uploadCoverImage(article.coverImage);
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

  try {
    const posted = await callVk<{ post_id?: number | string }>("wall.post", {
      owner_id: communityId,
      from_group: 1,
      message,
      // Present whenever a cover made it up; omitted otherwise, because VK treats an empty
      // string as a malformed attachment and rejects the whole post.
      ...(photoId ? { attachments: photoId } : {}),
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
    if (photoId && posted?.post_id != null) {
      const postId = String(posted.post_id);
      const landed = await readWallPostAttachments(postId);

      // `null` means the read failed, which is not evidence of anything; only a post that was
      // read and has nothing on it is worth repairing.
      if (landed && landed.length === 0) {
        logError(`пост ${postId} создан без вложения — дописываю обложку через wall.edit`);
        try {
          await callVk("wall.edit", {
            owner_id: communityId,
            post_id: postId,
            attachments: photoId,
          });

          const repaired = await readWallPostAttachments(postId);
          if (repaired && repaired.length === 0) {
            warning = joinWarning(
              warning,
              "ВК принял пост без обложки и не прикрепил её даже после правки",
            );
          } else {
            log(`обложка дописана к посту ${postId}`);
          }
        } catch (error) {
          warning = joinWarning(
            warning,
            `ВК создал пост без обложки, дописать не удалось: ${
              error instanceof Error ? error.message : "неизвестная ошибка"
            }`,
          );
        }
      }
    }

    log(
      `готово: пост ${posted?.post_id ?? "?"}, вложение: ${photoId ?? "нет"}${
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

/** Removes a wall post. Used by the test button so a probe does not stay on the wall. */
export async function deleteWallPost(postId: string): Promise<boolean> {
  try {
    await callVk<number>("wall.delete", { owner_id: vkOwnerId(), post_id: postId });
    log(`тестовый пост ${postId} удалён со стены`);
    return true;
  } catch (error) {
    logError(
      `тестовый пост ${postId} удалить не удалось:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
