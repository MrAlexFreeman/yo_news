/**
 * Video embed helpers for the editorial body.
 *
 * The editor pastes a link to a video on VK, YouTube or Rutube; this turns that
 * into the iframe markup the article page renders. Everything is matched against
 * fixed hostnames and id patterns — the URL is never interpolated into an iframe
 * `src` verbatim, because an embed that can point anywhere is an injection
 * vector, not a video player.
 */

/** Hosts we are willing to frame, and the path shape each one uses. */
type Provider = {
  label: string;
  hosts: readonly string[];
  build: (url: URL) => string | null;
};

const PROVIDERS: readonly Provider[] = [
  {
    label: "YouTube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"],
    build: (url: URL): string | null => {
      // youtu.be/<id> puts the id straight in the path with no prefix at all,
      // which is the shape the share sheet produces.
      if (url.hostname.endsWith("youtu.be")) {
        const short = url.pathname.split("/").filter(Boolean)[0];
        if (short && /^[A-Za-z0-9_-]{6,20}$/.test(short)) {
          return `https://www.youtube.com/embed/${short}`;
        }
        return null;
      }

      // youtube.com/watch?v=ID, /embed/ID or /shorts/ID
      const fromQuery = url.searchParams.get("v");
      const fromPath = url.pathname.match(
        /(?:embed|shorts|v)\/([A-Za-z0-9_-]{6,20})/,
      )?.[1];
      const id = fromQuery ?? fromPath;
      return id ? `https://www.youtube.com/embed/${id}` : null;
    },
  },
  {
    label: "Rutube",
    hosts: ["rutube.ru", "www.rutube.ru"],
    build: (url: URL): string | null => {
      const id = url.pathname.match(/video\/([A-Za-z0-9]+)/)?.[1];
      return id ? `https://rutube.ru/play/embed/${id}` : null;
    },
  },
  {
    label: "VK Видео",
    hosts: ["vk.com", "www.vk.com", "m.vk.com", "vk.ru", "www.vk.ru", "m.vk.ru"],
    build: (url: URL): string | null => {
      const fromQuery = url.searchParams.get("z");
      const fromPath = url.pathname.match(/video(-?\d+)_(\d+)/)?.[0];
      const pair = fromPath ?? fromQuery ?? "";
      const match = pair.match(/video(-?\d+)_(\d+)/);
      if (!match) return null;

      // autoplay=0 is explicit rather than left to VK's default: a player that
      // starts moving the moment it scrolls into view is startling on a news
      // page, and VK's own player URL carries whatever the share sheet happened to
      // include. Anything the editor pasted in the `autoplay` position is dropped
      // for the same reason.
      return (
        `https://vk.com/video_ext.php?oid=${encodeURIComponent(match[1])}` +
        `&id=${encodeURIComponent(match[2])}&autoplay=0`
      );
    },
  },
];

/** Hosts whose iframes survive sanitising. Mirrors PROVIDERS. */
export const VIDEO_EMBED_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "youtube-nocookie.com",
  "rutube.ru",
  "www.rutube.ru",
  "vk.com",
  "www.vk.com",
  "vk.ru",
  "www.vk.ru",
] as const;

/** True when `url` is an https embed we recognise. */
export function isAllowedVideoEmbed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return (VIDEO_EMBED_HOSTS as readonly string[]).includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Converts a pasted video URL into iframe markup, or null when the link is not
 * a video this project knows how to embed.
 */
export function buildVideoEmbed(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    // Bare hostnames arrive without a scheme from copy-paste.
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  for (const provider of PROVIDERS) {
    if (!provider.hosts.includes(parsed.hostname)) continue;

    const src = provider.build(parsed);
    if (!src) return null;

    return [
      '<figure class="video-embed">',
      `<iframe src="${src}" title="Видео" loading="lazy"`,
      ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"',
      ' allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>',
      "</figure>",
    ].join("");
  }

  return null;
}

/** Provider name for a URL, for the editor's error message. */
export function unsupportedVideoMessage(input: string): string {
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return `Не удалось встроить видео с ${parsed.hostname}. Поддерживаются YouTube, Rutube и VK Видео.`;
  } catch {
    return "Не удалось встроить видео. Поддерживаются YouTube, Rutube и VK Видео.";
  }
}