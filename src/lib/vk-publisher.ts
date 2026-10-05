/**
 * Auto-repost of published articles to a VK community wall.
 *
 * Flow when a cover image is attached:
 *   photos.getWallUploadServer в†’ POST the bytes to VK в†’ photos.saveWallPhoto в†’ wall.post
 *
 * Every step degrades gracefully: if the tokens are missing (local dev) or any
 * call fails, the post still goes out as text with a link.
 */

import type { getSetting as GetSetting } from "@/lib/settings";

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
  /** Set when the post went out without the cover image. */
  warning?: string;
  error?: string;
};

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string };
};

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

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
 * fresh token into /admin/settings replaces the wall reposter immediately вЂ” with no
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
 * Title, blank line, lead, then the article link. VK truncates posts with an
 * ellipsis when the link is buried, so it goes last.
 */
export function buildPostText(article: VkArticle): string {
  const link = `${siteUrl()}/news/${article.slug}`;
  const lead = article.lead?.trim();

  return lead ? `${article.title}\n\n${lead}\n\n${link}` : `${article.title}\n\n${link}`;
}

/**
 * Uploads the cover image and returns the `photo` attachment id.
 *
 * The two-step dance is required: VK hands out a one-off upload server, we
 * POST the raw bytes as multipart, then we trade the resulting `server`
 * response for a permanent photo id.
 */
async function uploadCoverImage(
  communityId: string,
  imageUrl: string,
): Promise<string | null> {
  const uploadServer = await callVk<{
    upload_url: string;
    photo: string;
  }>("photos.getWallUploadServer", { group_id: communityId });

  const image = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!image.ok) {
    throw new Error(`cover image fetch failed with HTTP ${image.status}`);
  }

  const form = new FormData();
  form.append("photo", new Blob([await image.arrayBuffer()]), "cover.jpg");
  form.append("server", uploadServer.upload_url);
  form.append("photo", uploadServer.photo);
  form.append("hash", uploadServer.photo);

  const uploadResponse = await fetch(uploadServer.upload_url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploadResponse.ok) {
    throw new Error(`cover upload failed with HTTP ${uploadResponse.status}`);
  }

  const uploaded = (await uploadResponse.json()) as { response?: { server: number; photo: string; hash: string } };
  if (!uploaded.response) {
    throw new Error("cover upload returned no response payload");
  }

  const saved = await callVk<{ server: number; photo: string; hash: string }>(
    "photos.saveWallPhoto",
    {
      group_id: communityId,
      server: uploaded.response.server,
      photo: uploaded.response.photo,
      hash: uploaded.response.hash,
    },
  );

  return saved.photo ?? null;
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
        "Р’Рљ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ: Р·Р°РґР°Р№С‚Рµ VK_COMMUNITY_ID Рё С‚РѕРєРµРЅ Р’Рљ РІ СЂР°Р·РґРµР»Рµ В«РќР°СЃС‚СЂРѕР№РєРёВ» РёР»Рё РІ .env",
    };
  }

  const communityId = vkOwnerId();
  const message = buildPostText(article);
  const attachmentIds: string[] = [];
  let warning: string | undefined;

  if (article.coverImage) {
    try {
      const photoId = await uploadCoverImage(communityId, article.coverImage);
      if (photoId) {
        attachmentIds.push(photoId);
      } else {
        warning = "Р’Рљ РЅРµ РІРµСЂРЅСѓР» id Р·Р°РіСЂСѓР¶РµРЅРЅРѕРіРѕ С„РѕС‚Рѕ вЂ” РїРѕСЃС‚ РѕС‚РїСЂР°РІР»РµРЅ Р±РµР· РѕР±Р»РѕР¶РєРё";
      }
    } catch (error) {
      // The post itself is still worth publishing without the image.
      warning = `РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РѕР±Р»РѕР¶РєСѓ: ${
        error instanceof Error ? error.message : "РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°"
      }`;
    }
  }

  try {
    const posted = await callVk<{ post_id?: number | string }>("wall.post", {
      owner_id: communityId,
      from_group: 1,
      message,
      ...(attachmentIds.length > 0 ? { attachments: attachmentIds.join(",") } : {}),
    });

    return {
      ok: true,
      postId: posted?.post_id != null ? String(posted.post_id) : null,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "РЅРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР° Р’Рљ",
    };
  }
}
