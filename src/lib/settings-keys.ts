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
 */
export const ALLOWED_KEYS = ["DEEPSEEK_API_KEY", "DEEPINFRA_API_KEY"] as const;

export type SettingKey = (typeof ALLOWED_KEYS)[number];

/** Where a resolved value came from, so the UI can say where it lives. */
export type SettingSource = "database" | "environment" | "unset";

/** Request field name → setting key, for the settings POST route. */
export const FIELD_BY_NAME: Record<string, SettingKey> = {
  deepseekApiKey: "DEEPSEEK_API_KEY",
  deepinfraApiKey: "DEEPINFRA_API_KEY",
};

export function isAllowedKey(key: string): key is SettingKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
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