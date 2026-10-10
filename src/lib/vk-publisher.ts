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
  title: string;
  lead?: string | null;
  slug: string;
  coverImage?: string | null;
};

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
  error?: { error_code?: number; error_msg?: string };
};

/**
 * VK accepts the group id with or without the leading minus, but the `owner_id`
 * parameter always needs the negative form.
 *
 * Editors paste whatever the address bar shows, so all of these have to work:
 *
 *   "-241944021"                    -> -241944021
 *   "241944021"                     -> -241944021
 *   "https://vk.ru/club241944021"   -> -241944021
 *   "public241944021"               -> -241944021
 *   "https://vk.ru/eartnews"        -> -publiceartnews
 *
 * The last case is a custom short name rather than a number: VK addresses those
 * as "public" + the slug. Falling through to a raw concatenation would send
 * owner_id="-https://vk.ru/eartnews", which fails every wall.post with an opaque
 * API error that reads like a token problem.
 */
export function vkOwnerId(): string {
  const raw = process.env.VK_COMMUNITY_ID?.trim() ?? "";

  // Reduce a full URL to its last path segment, so "https://vk.ru/eartnews" and a
  // bare "eartnews" take the same branch. A bare id has no separator and is
  // already its own segment.
  const segment = raw.split(/[/?#]/).filter(Boolean).pop() ?? "";

  const fromClub = segment.match(/^club(\d+)$/i);
  if (fromClub) return `-${fromClub[1]}`;

  const fromPublic = segment.match(/^public(\d+)$/i);
  if (fromPublic) return `-${fromPublic[1]}`;

  if (/^-?\d+$/.test(segment)) return `-${segment.replace(/^-/, "")}`;

  if (/^[a-z][a-z0-9_.]*$/i.test(segment)) return `-public${segment}`;

  return `-${raw}`;
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
  if (!response.ok) {
    throw new Error(`VK ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as VkEnvelope<T>;
  if (payload.error) {
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

  // `photo` comes back as an empty string on the wall upload — the identifier is minted at
  // saveWallPhoto from the server and hash. It is required to be present, so that a
  // truncated or error body cannot pass as a success.
  return { server, photo: typeof photo === "string" ? photo : "", hash };
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

/** Uploads the cover to VK's one-off server and returns the saved wall photo id. */
async function uploadCoverImage(imageUrl: string): Promise<string | null> {
  /*
    The positive id, and not the negative owner id.

    Measured on production, and the two are not interchangeable: getWallUploadServer accepts
    either and returns a usable upload server for both, so nothing warns you. saveWallPhoto
    rejects the negative form outright — "group_id should be greater or equal to 0" — which
    meant the photo never got saved, `photoId` came back null, and every wall post went out
    as text. Passing the same `communityId` to both looked correct and silently was not.
  */
  const groupId = vkCommunityId();

  const uploadServer = await callVk<{
    upload_url: string;
    album_id: number;
  }>("photos.getWallUploadServer", { group_id: groupId });

  const { bytes, contentType } = await readCoverImage(imageUrl);
  const extension = extensionFor(contentType) ?? ".jpg";

  const uploaded = await postToVkUploadServer(uploadServer.upload_url, bytes, extension, contentType);

  const saved = await callVk<unknown>("photos.saveWallPhoto", {
    group_id: groupId,
    server: uploaded.server,
    photo: uploaded.photo,
    hash: uploaded.hash,
  });

  return vkPhotoAttachmentId(saved);
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

async function postToVkUploadServer(
  uploadUrl: string,
  bytes: ArrayBuffer,
  extension: string,
  contentType: string,
): Promise<VkUploadResult> {
  let lastProblem = "";

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    // Built inside the loop because a Blob cannot be appended twice to the same body, and
    // a new FormData per attempt is cheaper than reasoning about a consumed stream.
    const form = new FormData();
    form.append("photo", new Blob([bytes], { type: contentType }), `cover${extension}`);

    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        // VK serves an HTML error page for these, so the status is the only usable signal.
        lastProblem = `cover upload failed with HTTP ${response.status}`;
        // Only a server-side status is worth repeating; a 4xx means the request itself is
        // wrong and a second identical request will be wrong in exactly the same way.
        if (response.status < 500) throw new Error(lastProblem);
        await sleepBeforeRetry(attempt);
        continue;
      }

      const result = parseVkUploadResult(await response.json().catch(() => null));
      if (!result) throw new Error("cover upload returned no usable payload");
      return result;
    } catch (error) {
      // A 4xx or an unreadable body is not going to improve on a second try.
      if (error instanceof Error && error.message === lastProblem) throw error;
      lastProblem = error instanceof Error ? error.message : "unknown upload error";
      await sleepBeforeRetry(attempt);
    }
  }

  throw new Error(lastProblem || "cover upload failed");
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
  if (!vkCommunityId() || !(await resolveToken().catch(() => ""))) {
    return {
      ok: false,
      error:
        "ВК не настроен: задайте VK_COMMUNITY_ID и токен ВК в разделе «Настройки» или в .env",
    };
  }

  const communityId = vkOwnerId();
  const message = buildPostText(article);
  /** The wall photo, or null when there was no cover or the upload failed. */
  let photoId: string | null = null;
  let warning: string | undefined;

  if (article.coverImage) {
    try {
      photoId = await uploadCoverImage(article.coverImage);
      if (!photoId) {
        warning = "ВК не вернул id загруженного фото — пост отправлен без обложки";
      }
    } catch (error) {
      // The post itself is still worth publishing without the image.
      warning = `Не удалось загрузить обложку: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
      }`;
    }
  }

  /**
 * Size VK renders the link card at.
 *
 * Not optional, and not guessable: VK answers a `wall.post` carrying a link attachment
 * without this with error 100, "Violated: link_photo_sizing_rule. No photo given" — measured
 * on production. The message names a rule that looks satisfied, because a photo *was* given;
 * what it means is that the rule for the link preview has not been set.
 *
 * 1080x720 rather than the largest option: the cover itself is 1080 wide, so a bigger
 * preview would be upscaled by VK from nothing.
 */
try {
    const posted = await callVk<{ post_id?: number | string }>("wall.post", {
      owner_id: communityId,
      from_group: 1,
      message,
      // Present whenever a cover made it up; omitted otherwise, because VK treats an empty
      // string as a malformed attachment and rejects the whole post.
      ...(photoId ? { attachments: photoId } : {}),
    });

    return {
      ok: true,
      postId: posted?.post_id != null ? String(posted.post_id) : null,
      photoId: photoId ?? null,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "неизвестная ошибка ВК",
    };
  }
}
