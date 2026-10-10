/**
 * Pure settings primitives: the key allowlist, masking, and the view shape.
 *
 * Free of `server-only` and of Prisma so the security suite can import it. The
 * allowlist is the boundary that stops a generic settings endpoint from handing
 * out ADMIN_PASSWORD or DATABASE_URL, and a security boundary that cannot be
 * tested directly is a boundary nobody re-checks when the list changes.
 */

/**
 * The only keys this project will store or serve.
 *
 * Deliberately a closed list rather than whatever a caller passes in. A generic
 * settings endpoint that accepted an arbitrary `key` would expose every secret
 * the process holds. Adding a setting means adding it here too, which is the
 * reviewable step.
 *
 * `VK_ACCESS_TOKEN` joined the list when VK video upload landed. It shares the
 * read path with the wall reposter, so an editor changing it here affects both —
 * which is the point, and the reason the reposter reads through `getSetting`
 * rather than `process.env` (see lib/vk-publisher.ts).
 *
 * The six messenger keys joined the list with auto-posting to Telegram and MAX.
 * They are stored and read exactly like an API key — database first, `.env`
 * second — but they are reached through `SYNDICATION_FIELDS` and their own route
 * rather than `FIELD_BY_NAME`, because a destination and a boolean are not
 * tokens and the token validator would reject "@eartnews" and "true".
 *
 * A key must appear in exactly one field map: that is what makes every allowed key
 * reachable from some route and no key reachable from two routes with different
 * validation.
 */
export const ALLOWED_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPINFRA_API_KEY",
  "VK_ACCESS_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHANNEL_ID",
  "TELEGRAM_ENABLED",
  "TELEGRAM_API_ROOT",
  "MAX_BOT_TOKEN",
  "MAX_CHAT_ID",
  "MAX_ENABLED",
  "LIVE_STREAM_ENABLED",
  "LIVE_STREAM_URL",
  "LIVE_STREAM_TITLE",
  "FAL_API_KEY",
  "HUGGINGFACE_API_KEY",
] as const;

export type SettingKey = (typeof ALLOWED_KEYS)[number];

/** Where a resolved value came from, so the UI can say where it lives. */
export type SettingSource = "database" | "environment" | "unset";

/** Request field name → setting key, for the settings POST route. */
export const FIELD_BY_NAME: Record<string, SettingKey> = {
  deepseekApiKey: "DEEPSEEK_API_KEY",
  deepinfraApiKey: "DEEPINFRA_API_KEY",
  vkAccessToken: "VK_ACCESS_TOKEN",
  falApiKey: "FAL_API_KEY",
  huggingfaceApiKey: "HUGGINGFACE_API_KEY",
};

/**
 * How a syndication field is validated, and therefore what it may hold.
 *
 * `token` is an opaque credential and gets the length and charset rules the API
 * keys do. `destination` is a chat or channel reference — "@eartnews", "-100…",
 * or a bare numeric id — so a charset that forbids "@" and "-" would reject every
 * value Telegram actually uses. `flag` is the literal "true"/"false". `url` is an
 * absolute https endpoint, for the Telegram API root.
 */
export type SyndicationFieldKind = "token" | "destination" | "flag" | "url";

export type SyndicationField = {
  key: SettingKey;
  kind: SyndicationFieldKind;
};

export const SYNDICATION_FIELDS = {
  telegramBotToken: { key: "TELEGRAM_BOT_TOKEN", kind: "token" },
  telegramChannelId: { key: "TELEGRAM_CHANNEL_ID", kind: "destination" },
  telegramEnabled: { key: "TELEGRAM_ENABLED", kind: "flag" },
  telegramApiRoot: { key: "TELEGRAM_API_ROOT", kind: "url" },
  maxBotToken: { key: "MAX_BOT_TOKEN", kind: "token" },
  maxChatId: { key: "MAX_CHAT_ID", kind: "destination" },
  maxEnabled: { key: "MAX_ENABLED", kind: "flag" },
} as const satisfies Record<string, SyndicationField>;

export type SyndicationFieldName = keyof typeof SYNDICATION_FIELDS;

/**
 * The «Прямой эфир» badge, and the third settings area.
 *
 * Not syndication, and not an API key: a flag, a URL and a short label that decide whether
 * the masthead prints a badge. They get their own map for the same reason the messengers
 * do — the token validator would reject all three, and the API-key validator would accept a
 * `javascript:` URL without complaint, which is the one value here that reaches an `href`.
 *
 * The URL and the label are validated in `lib/live-stream.ts` rather than through
 * `SyndicationFieldKind`, because `url` here means "a destination a reader clicks" and not
 * "the API root a bot token is sent to": the first may be a site-relative path, and the
 * second must never be.
 */
export const LIVE_STREAM_FIELDS = {
  liveStreamEnabled: { key: "LIVE_STREAM_ENABLED" },
  liveStreamUrl: { key: "LIVE_STREAM_URL" },
  liveStreamTitle: { key: "LIVE_STREAM_TITLE" },
} as const satisfies Record<string, { key: SettingKey }>;

export type LiveStreamFieldName = keyof typeof LIVE_STREAM_FIELDS;

export function isAllowedKey(key: string): key is SettingKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

/** Long enough to reject an obvious typo, short enough to reject a pasted page. */
const MIN_TOKEN_LENGTH = 8;
const MAX_TOKEN_LENGTH = 300;

/**
 * Token charset only: no spaces, no quotes, no control characters.
 *
 * Shared in shape with the API-key route, and for the same reason — this is a check
 * that the field holds one token rather than a sentence somebody pasted by accident,
 * not format validation for a specific provider. Both Telegram and MAX issue opaque
 * strings, and guessing a prefix would reject a valid one on a change.
 *
 * The colon is allowed and is not an oversight: a Telegram token is issued as
 * `<bot_id>:<secret>` and *every* real one contains it, so a charset without it would
 * refuse all of them. The API-key route keeps its own narrower pattern because none of
 * DEEPSEEK_API_KEY, DEEPINFRA_API_KEY or VK_ACCESS_TOKEN contains one, and widening it
 * there would relax a route that has no reason to be relaxed.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9._~:-]+$/;

/**
 * What a chat or channel reference may look like.
 *
 * Telegram addresses a channel as "@name", a supergroup as "-1001234567890", and a
 * plain chat as a bare id. MAX uses a numeric chat_id and nothing else. The leading
 * "@" or "-" is allowed, and so is "." for a host-style reference, but whitespace and
 * quotes are not — this value is pasted into a request path or body, and a value that
 * needs escaping is a sign the editor pasted the wrong thing.
 */
const DESTINATION_PATTERN = /^@?-?[A-Za-z0-9_.-]+$/;
const MAX_DESTINATION_LENGTH = 100;

/**
 * What an API root may be, and the four things it may not.
 *
 * The value becomes the host every Telegram request is sent to — *including the one
 * carrying the bot token*. So this is the one field in the settings table that can
 * be used to exfiltrate a stored credential rather than merely misuse it: an editor
 * who cannot read the token (it is masked and never sent to the browser) can point
 * this at their own server and read the token out of the request that follows.
 * Documented here because it is the reason the field is https-only and rejects
 * credentials, and the reason the report says an operator may prefer to pin it in
 * `.env` and not expose it.
 *
 * The rules:
 *   - absolute https URL only. A plaintext http root would put the bot token on the
 *     wire; the single exception is loopback, where a local nginx reverse proxy is a
 *     legitimate deployment and the traffic never leaves the host.
 *   - no userinfo. `https://user:pass@host` would put a credential in this stored
 *     value, in the page that renders it, and in every error message that echoes a URL.
 *   - no query, no fragment: a request path is appended to this value.
 */
export function validateApiRoot(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Ожидается полный URL, например https://api.telegram.org";
  }

  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return "Разрешён только https. Исключение — localhost для локального прокси.";
  }
  if (parsed.username || parsed.password) {
    return "URL не должен содержать логин и пароль.";
  }
  if (parsed.search || parsed.hash) {
    return "URL не должен содержать параметры или якорь — к нему добавляется путь запроса.";
  }
  if (value.length > 200) {
    return "Слишком длинный адрес.";
  }

  return null;
}

/**
 * The literal spellings a flag accepts.
 *
 * Only these two. "1", "yes" and "да" are accepted on the way *in* by
 * `parseEnabled` for hand-written POSTs, but the form sends exactly one of them, and
 * what lands in the database is always one of the two — otherwise a checkbox and its
 * stored value could disagree without anything noticing.
 */
const FLAG_VALUES = ["true", "false"] as const;

export type FlagValue = (typeof FLAG_VALUES)[number];

/**
 * Validates one syndication field, returning the error to show or null if it is fine.
 *
 * Lives here rather than in the route so the rules are importable without
 * `server-only`, and so `messenger:check` can assert them without a database.
 */
export function validateSyndicationField(
  field: SyndicationField,
  value: string,
): string | null {
  const trimmed = value.trim();

  /*
    Empty is never a validation error, for any kind: it means "clear this", which the
    route handles by deleting the row so the `.env` value takes over again.

    This has to come before the `flag` branch as well. An unchecked checkbox is an
    empty field, not the string "false" — the route's own boolean handling maps a
    missing value to a flag, but a form that posts `""` for an untouched flag must not
    be told that `""` is not a valid flag.
  */
  if (!trimmed) return null;

  if (field.kind === "flag") {
    return (FLAG_VALUES as readonly string[]).includes(trimmed)
      ? null
      : "Ожидается true или false.";
  }

  if (field.kind === "url") {
    return validateApiRoot(trimmed);
  }

  if (field.kind === "destination") {
    if (trimmed.length > MAX_DESTINATION_LENGTH) {
      return "Слишком длинное значение — проверьте, что вставили идентификатор целиком.";
    }
    if (!DESTINATION_PATTERN.test(trimmed)) {
      return "Ожидается @юзернейм, -100… или числовой идентификатор.";
    }
    return null;
  }

  if (trimmed.length < MIN_TOKEN_LENGTH) {
    return `Токен слишком короткий — минимум ${MIN_TOKEN_LENGTH} символов.`;
  }
  if (trimmed.length > MAX_TOKEN_LENGTH) {
    return "Токен слишком длинный — проверьте, что вставили его целиком.";
  }
  if (!TOKEN_PATTERN.test(trimmed)) {
    return "Токен содержит пробелы или недопустимые символы. Нужен один непрерывный токен без кавычек.";
  }
  return null;
}

/**
 * Whether auto-posting is on when the stored value says nothing useful.
 *
 * An unset or unrecognised value falls back rather than defaulting to off: the whole
 * point of the Telegram checkbox is that a fresh install syndicates there, and MAX
 * stays off until somebody turns it on. Getting this backwards in either direction
 * silently stops publication, which is the failure nobody notices for a week.
 */
export function parseEnabled(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();

  if (value === "true" || value === "1" || value === "on" || value === "да") return true;
  if (value === "false" || value === "0" || value === "off" || value === "нет") return false;

  return fallback;
}

/** Per-messenger default for an absent `*_ENABLED` setting. */
export const DEFAULT_SYNDICATION_ENABLED = {
  telegram: true,
  max: false,
} as const;

/**
 * Whether a destination and a credential are both present.
 *
 * A messenger with no token is not misconfigured, it is simply not set up yet, and
 * the difference matters: the first is worth a red toast, the second is the normal
 * state of a fresh install and must not produce a warning on every article.
 */
export function isMessengerConfigured(token: string, destination: string): boolean {
  return token.trim().length > 0 && destination.trim().length > 0;
}

/**
 * The API-key fields, and what each provider's key may contain.
 *
 * Lives here rather than in `/api/admin/settings` for the same reason the other validators
 * do: the rules are then reachable from a plain script, so a charset can be asserted directly
 * instead of being discovered by an editor pasting a real key. That is exactly how the fal
 * one went unnoticed — the pattern sat inside the route, nothing tested it, and the field
 * refused every key the provider actually issues.
 *
 * `token` is the shared shape: opaque credential, no spaces, no quotes, no control
 * characters. It is a check that the field holds one key and not a sentence somebody pasted
 * by accident, which would fail confusingly at the provider instead.
 *
 * The colon is allowed for fal alone because fal.ai issues `<key_id>:<key_secret>`, and it
 * is part of the credential rather than decoration. The entry is per field, not merged into
 * the shared pattern: no other provider here uses it, and widening the charset for everyone
 * would relax a route with no reason to be relaxed. A field absent from the map keeps the
 * strict shape, so adding a provider without thinking about this fails closed.
 */

/** Long enough to reject an obvious typo, short enough to reject a pasted page. */
export const MIN_API_KEY_LENGTH = 8;
export const MAX_API_KEY_LENGTH = 300;

const API_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

const API_KEY_PATTERN_BY_FIELD: Record<string, RegExp> = {
  // The hyphen sits last in the class on purpose: anywhere else it reads as a range, and
  // `._~-:` parses as "every character from ~ to :", which is not a character class at all —
  // TypeScript rejects it outright, and a runtime that did not would quietly accept a
  // hundred-odd unrelated symbols as a valid key.
  falApiKey: /^[A-Za-z0-9._~:-]+$/,
  // The `hf_` prefix is not decoration. Hugging Face issues every access token in this
  // shape and the dashboard offers nothing else to paste, so requiring it turns "this is
  // not the right kind of credential" into a message at the point of paste instead of a
  // 401 from the provider after the key is stored.
  //
  // The body is `A-Za-z0-9` — base62, the alphabet of a random token — and deliberately
  // no underscore: the separator is the prefix's own, and a second one inside the body
  // would mean a pasted sentence rather than a token.
  huggingfaceApiKey: /^hf_[A-Za-z0-9]+$/,
};

/**
 * The literal every Hugging Face access token begins with.
 *
 * Exported so the test-connection route and the form hint quote one string, and so a
 * check can assert the pattern's prefix against it instead of re-typing `hf_` in a
 * place that would keep passing if the pattern changed without it.
 */
export const HUGGINGFACE_TOKEN_PREFIX = "hf_";

/** The charset for one request field, defaulting to the strict token shape. */
export function apiKeyPatternFor(name: string): RegExp {
  return API_KEY_PATTERN_BY_FIELD[name] ?? API_KEY_PATTERN;
}

/**
 * Validates one API-key field, returning the message to show or null if it is fine.
 *
 * Empty is not an error, for the same reason it is not for the messenger fields: it means
 * "clear this override", which the route turns into a delete so the `.env` value takes over.
 */
export function validateApiKeyField(name: string, value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  /*
    Hugging Face's own message, checked before the length rule and before the generic
    charset one. A wrong credential here is almost never a malformed token — it is a
    Read token pasted where a Write one belongs, or a token from the wrong provider
    entirely — and "contains invalid characters" describes none of those. The generic
    fallback below still catches a genuine typo in the body.
  */
  if (name === "huggingfaceApiKey" && !trimmed.startsWith(HUGGINGFACE_TOKEN_PREFIX)) {
    return `Ключ Hugging Face начинается с «${HUGGINGFACE_TOKEN_PREFIX}». Убедитесь, что это access-токен из huggingface.co/settings/tokens, а не токен другого сервиса.`;
  }

  if (trimmed.length < MIN_API_KEY_LENGTH) {
    return `Ключ слишком короткий — минимум ${MIN_API_KEY_LENGTH} символов.`;
  }
  if (trimmed.length > MAX_API_KEY_LENGTH) {
    return "Ключ слишком длинный — проверьте, что вставили ключ целиком.";
  }
  if (!apiKeyPatternFor(name).test(trimmed)) {
    return "Ключ содержит пробелы или недопустимые символы. Нужен один непрерывный токен без кавычек.";
  }

  return null;
}

/**
 * Shows enough of a key to tell two apart, and nothing more.
 *
 * The real value never reaches the browser — not masked, not base64, not
 * encrypted with a key that also lives in the browser. "sk-…ab12" is a
 * convenience for the editor, not a protection boundary.
 */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Too short to show any of it without giving most of it away.
  if (trimmed.length <= 10) return "•".repeat(trimmed.length);

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

/** What crosses the wire instead of a key: never contains the value itself. */
export type SettingView = {
  isSet: boolean;
  masked: string;
  source: SettingSource;
};

export function toView(resolved: { value: string; source: SettingSource }): SettingView {
  return {
    isSet: resolved.value.length > 0,
    masked: maskSecret(resolved.value),
    source: resolved.source,
  };
}

/** The state the settings page renders from, keyed by request field name. */
export type SettingsViewState = Record<string, SettingView>;

/**
 * Folds a save or clear response back into what the page shows.
 *
 * The POST route answers with the state of *every* setting after the write, because
 * only the server knows whether a cleared key fell back to `.env` or to nothing.
 * The page has to adopt that answer: rendering from the server-rendered props alone
 * left the form showing the state from before the save, so pasting a first key and
 * pressing Save produced a green "settings saved" next to a field that still read
 * "key not set" — which reads to an editor as the key having vanished.
 *
 * A missing key in the incoming state is kept rather than dropped, so a partial
 * answer cannot blank a field the server did not mention.
 */
export function mergeSettings(
  current: SettingsViewState,
  incoming: SettingsViewState | undefined,
): SettingsViewState {
  if (!incoming) return current;
  return { ...current, ...incoming };
}