import "server-only";

import { getSetting } from "@/lib/settings";
import {
  VkVideoError,
  assertVkUploadUrl,
  buildEditFields,
  parseVideoIdsFromUrl,
} from "@/lib/vk-video-format";

/**
 * VK Video calls that carry a token.
 *
 * The parsing and text-building live in vk-video-format.ts so the security suite
 * can reach them: `server-only` throws outside a React Server Component, which
 * would leave the upload-URL guard untested — and that guard is the one piece of
 * this feature that decides whether the server would send an editor's file
 * somewhere it must not.
 */

const VK_API_BASE = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string };
};

/**
 * Calls one VK method with an explicit token.
 *
 * `video.save` and `video.edit` accept either `access_token` or an `owner_id` for
 * community-scoped calls; the token is always sent explicitly so the same helper
 * works with a user token an editor pasted into the settings page.
 */
export async function callVkApi<T>(
  method: string,
  token: string,
  params: Record<string, string | number>,
  timeoutMs = 20_000,
): Promise<T> {
  const url = new URL(`${VK_API_BASE}/${method}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("v", VK_API_VERSION);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new VkVideoError(`ВК ${method}: HTTP ${response.status}`, "prepare");
  }

  const payload = (await response.json()) as VkEnvelope<T>;
  if (payload.error) {
    throw new VkVideoError(
      `ВК ${method}: ${payload.error.error_msg ?? "неизвестная ошибка"} (${
        payload.error.error_code ?? "?"
      })`,
      "prepare",
    );
  }

  return payload.response as T;
}

/** Reads the token through the settings service, like every other VK call. */
export async function requireVkToken(): Promise<string> {
  const token = await getSetting("VK_ACCESS_TOKEN");
  if (!token) {
    throw new VkVideoError(
      "Не задан токен ВК. Укажите его в разделе «Настройки» (/admin/settings) или в .env.",
      "prepare",
    );
  }
  return token;
}

/**
 * Renames a VK video to match the article it was uploaded for.
 *
 * Never throws. The video is already on VK and the article is already in the
 * database by the time this runs, so a VK outage must not turn a successful
 * publish into a failed save — the reason comes back instead.
 *
 * Only called when the article is *entering* `published`: re-running on every
 * later edit would push the current headline over an already-published video each
 * time somebody fixed a typo.
 */
export async function renameVkVideoForArticle(input: {
  videoUrl: string | null | undefined;
  title: string;
  lead?: string | null;
  slug: string;
  baseUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ids = input.videoUrl ? parseVideoIdsFromUrl(input.videoUrl) : null;
  if (!ids) {
    // Nothing to do: no video, or it lives on another platform.
    return { ok: true };
  }

  try {
    const token = await requireVkToken();
    const { name, desc } = buildEditFields({
      title: input.title,
      lead: input.lead,
      articleUrl: `${input.baseUrl}/news/${input.slug}`,
    });

    await callVkApi(
      "video.edit",
      token,
      { video_id: ids.videoId, owner_id: ids.ownerId, name, desc },
      15_000,
    );

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "неизвестная ошибка ВК",
    };
  }
}

export { VkVideoError, assertVkUploadUrl, buildEditFields, parseVideoIdsFromUrl };