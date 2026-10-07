/**
 * Auto-repost of published articles to a VK community wall.
 *
 * Flow when a cover image is attached:
 *   photos.getWallUploadServer → POST the bytes to VK → photos.saveWallPhoto → wall.post
 *
 * Every step degrades gracefully: if the tokens are missing (local dev) or any
 * call fails, the post still goes out as text with a link.
 */

import { readFile } from "node:fs/promises";

import {
  contentTypeFor,
  resolveUploadPath,
  UPLOAD_URL_PREFIX,
} from "@/lib/upload-dir";
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
 * Title, blank line, lead, then the article link. VK truncates posts with an
 * ellipsis when the link is buried, so it goes last.
 */
export function buildPostText(article: VkArticle): string {
  const link = `${siteUrl()}/news/${article.slug}`;
  const lead = article.lead?.trim();

  return lead ? `${article.title}\n\n${lead}\n\n${link}` : `${article.title}\n\n${link}`;
}

/**
 * The bytes of a cover image, plus what VK should be told they are.
 *
 * Three cases, and they are not interchangeable:
 *
 * 1. `/uploads/<name>` — read from disk. This is the case that was broken: `fetch()`
 *    in Node rejects a relative URL outright ("Failed to parse URL from /uploads/…"),
 *    so every repost since uploads moved out of `public/` went out with no picture at
 *    all, and the only trace was a warning in the error log that reads like noise.
 *
 *    Reading the file is also the right call rather than building an absolute URL and
 *    fetching it: it avoids a request from the server to itself through nginx on every
 *    publish, and it does not depend on the public hostname being resolvable from
 *    inside the process — which is not true on every host.
 *
 * 2. `http(s)://…` — fetched. A cover may legitimately live somewhere else, and there
 *    is nothing to read from disk for it.
 *
 * 3. Any other relative path — a file Next serves from `public/`, say. Resolved
 *    against the site URL, which is the only way Node can fetch it.
 */
export async function readCoverImage(
  coverImage: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const trimmed = coverImage.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`cover image fetch failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return { bytes: await response.arrayBuffer(), contentType };
  }

  if (trimmed.startsWith(UPLOAD_URL_PREFIX)) {
    // `resolveUploadPath` is the same guard the /uploads route uses: it rejects a path
    // that would escape UPLOAD_DIR, so a stored value cannot be used to read an
    // arbitrary file off the server.
    const target = resolveUploadPath(trimmed.slice(UPLOAD_URL_PREFIX.length));
    if (!target) {
      throw new Error("cover image path escapes the upload directory");
    }

    const contentType = contentTypeFor(target);
    if (!contentType) {
      throw new Error("cover image is not a supported image format");
    }

    // Copied into a fresh ArrayBuffer rather than handed over as a Node Buffer: a
    // Buffer is a view onto a pool, and `Blob` will not accept a view whose buffer
    // may be a SharedArrayBuffer. The file is small and this happens once per post.
    const file = await readFile(target);
    return {
      bytes: Uint8Array.from(file).buffer,
      contentType,
    };
  }

  // Case 3. Made absolute here rather than at the call site so every caller of
  // `readCoverImage` gets the same behaviour.
  const response = await fetch(`${siteUrl()}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`cover image fetch failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  return { bytes: await response.arrayBuffer(), contentType };
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

  const { bytes, contentType } = await readCoverImage(imageUrl);

  const form = new FormData();
  // The filename keeps the real extension and the blob carries the real type. Both
  // were hardcoded to "cover.jpg" before, which meant a WebP cover was uploaded
  // claiming to be a JPEG — VK accepts it, and then serves a file whose bytes
  // disagree with its extension.
  form.append(
    "photo",
    new Blob([bytes], { type: contentType }),
    `cover${extensionFor(contentType) ?? ".jpg"}`,
  );
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

/** The extension that goes with a content type, for the multipart filename. */
function extensionFor(contentType: string): string | null {
  switch (contentType.split(";")[0]?.trim().toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return null;
  }
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
