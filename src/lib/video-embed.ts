/**
 * Video embed helpers for the editorial body.
 *
 * The editor pastes a link to a video on VK, YouTube or Rutube; this turns that
 * into the iframe markup the article page renders. Everything is matched against
 * fixed hostnames and id patterns — the URL is never interpolated into an iframe
 * `src` verbatim, because an embed that can point anywhere is an injection
 * vector, not a video player.
 */

/**
 * Player permissions on the generated iframe.
 *
 * Shared with the editor's video node so an embed pasted as raw HTML and one
 * inserted from the toolbar end up with identical permissions — two spellings of
 * the same policy would drift.
 */
export const VIDEO_EMBED_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

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

      return buildVkPlayerUrl(match[1]!, match[2]!);
    },
  },
];

/**
 * The VK player URL, with playback behaviour pinned.
 *
 * Two parameters are set explicitly rather than left to VK's defaults:
 *
 *   - `no_next=1` stops the player rolling on to whatever VK decides is next. On a
 *     news page that is the wrong behaviour outright — a reader who finishes one
 *     video should get the article's end, not an unrelated clip.
 *   - `autoplay=0` stops it the moment it scrolls into view.
 *
 * Both are forced rather than merely defaulted. VK's own share URL carries whatever
 * the share sheet happened to include, and an editor pasting a link with
 * `autoplay=1` in it should not be able to start a video by accident.
 *
 * Built through `URLSearchParams` instead of string concatenation so the values are
 * escaped once and a parameter can never be doubled: `set` replaces, so pasting a
 * link that already carries `no_next=0` cannot end up with both.
 */
export function buildVkPlayerUrl(oid: string, id: string): string {
  const params = new URLSearchParams({ oid, id });
  params.set("no_next", "1");
  params.set("autoplay", "0");
  return `https://vk.com/video_ext.php?${params.toString()}`;
}

/**
 * Adds the no-next and no-autoplay parameters to an already-built VK player URL.
 *
 * Exists for the path that bypasses {@link buildVideoEmbed}: an editor can paste a
 * finished `<iframe src="https://vk.com/video_ext.php?...">` straight into the body
 * HTML, and that block is preserved verbatim by the article normaliser. Without this
 * the guarantee would hold only for players we built ourselves, which is not the same
 * thing as "no video jumps to the next clip".
 *
 * Non-VK URLs, unparseable input and anything already carrying both parameters come
 * back untouched, so calling it twice is a no-op rather than a second `?`.
 */
export function ensureNoVkAutoplay(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== "https:") return url;
  if (!(VK_PLAYER_HOSTS as readonly string[]).includes(parsed.hostname)) return url;

  // Only the player endpoint: a VK link that is not an embed has nothing to pin.
  if (!/\/video_ext\.php$/.test(parsed.pathname)) return url;

  if (parsed.searchParams.get("no_next") === "1" && parsed.searchParams.get("autoplay") === "0") {
    return url;
  }

  parsed.searchParams.set("no_next", "1");
  parsed.searchParams.set("autoplay", "0");
  return parsed.toString();
}

/** Hosts that serve the VK player page this normalises. */
const VK_PLAYER_HOSTS = ["vk.com", "www.vk.com", "vk.ru", "www.vk.ru"] as const;

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
      ` allow="${VIDEO_EMBED_ALLOW}"`,
      ' allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>',
      "</figure>",
    ].join("");
  }

  return null;
}

/**
 * Hosts that refuse to be framed, named so the message can say which one and why.
 *
 * `cloud.mail.ru` answers with **both** `X-Frame-Options: SAMEORIGIN` and a
 * `Content-Security-Policy: frame-ancestors 'self' …` list that does not include this site —
 * measured against the live service, `eartnews.ru` appears nowhere in either. A browser
 * refuses to render such a frame, so an `<iframe>` pointing at an Облако Mail.ru page shows
 * an error inside the article rather than a player.
 *
 * Which makes this a *message* and not a provider: the brief asks for Mail.ru Cloud embeds
 * and they cannot be built. The honest thing to ship is a sentence naming the reason, so an
 * editor who pastes such a link learns that the host forbids it rather than concluding the
 * editor is broken — and learns what to do instead.
 *
 * Only the exact host, not `*.mail.ru`: the refusal was measured on this one and saying it
 * about a sibling nobody tested would be a guess presented as a finding.
 */
const REFUSES_TO_BE_FRAMED = ["cloud.mail.ru"] as const;

/** True for a host that will not render inside an iframe on this site. */
export function refusesToBeFramed(hostname: string): boolean {
  return (REFUSES_TO_BE_FRAMED as readonly string[]).includes(hostname.toLowerCase());
}

/**
 * Provider name for a URL, for the editor's error message.
 *
 * Three outcomes rather than two: one for a host we embed, one for a host that deliberately
 * blocks embedding, and one for everything else. The middle case is the reason this is more
 * than a lookup — a generic "unsupported" would be true and useless.
 */
export function unsupportedVideoMessage(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return "Не удалось встроить видео. Поддерживаются YouTube, Rutube и VK Видео.";
  }

  if (refusesToBeFramed(parsed.hostname)) {
    return (
      "Облако Mail.ru запрещает встраивать свои страницы в другие сайты: " +
      "в ответе стоят X-Frame-Options: SAMEORIGIN и Content-Security-Policy с " +
      "frame-ancestors, где eartnews.ru не указан, поэтому плеер внутри статьи " +
      "не откроется. Скачайте файл и загрузите его в VK Видео или на YouTube — " +
      "они встраиваются."
    );
  }

  return `Не удалось встроить видео с ${parsed.hostname}. Поддерживаются YouTube, Rutube и VK Видео.`;
}