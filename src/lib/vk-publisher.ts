/**
 * Auto-repost of published articles to a VK community wall.
 *
 * Flow when a cover image is attached:
 *   photos.getWallUploadServer → POST the bytes to VK → photos.saveWallPhoto → wall.post
 *
 * Every step degrades gracefully: if the tokens are missing (local dev) or any
 * call fails, the post still goes out as text with a link.
 */

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
function ownerId(): string {
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

function accessToken(): string {
  const token = process.env.VK_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("VK_ACCESS_TOKEN is not set");
  }
  return token;
}

/** Calls one VK method and unwraps its `response` field. */
async function callVk<T>(
  method: string,
  params: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`${VK_API_BASE}/${method}`);
  url.searchParams.set("access_token", accessToken());
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
  if (!process.env.VK_COMMUNITY_ID?.trim() || !process.env.VK_ACCESS_TOKEN?.trim()) {
    return {
      ok: false,
      error:
        "VK не настроен: задайте VK_COMMUNITY_ID и VK_ACCESS_TOKEN в .env",
    };
  }

  const communityId = ownerId();
  const message = buildPostText(article);
  const attachmentIds: string[] = [];
  let warning: string | undefined;

  if (article.coverImage) {
    try {
      const photoId = await uploadCoverImage(communityId, article.coverImage);
      if (photoId) {
        attachmentIds.push(photoId);
      } else {
        warning = "ВК не вернул id загруженного фото — пост отправлен без обложки";
      }
    } catch (error) {
      // The post itself is still worth publishing without the image.
      warning = `Не удалось загрузить обложку: ${
        error instanceof Error ? error.message : "неизвестная ошибка"
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
      error: error instanceof Error ? error.message : "неизвестная ошибка ВК",
    };
  }
}
