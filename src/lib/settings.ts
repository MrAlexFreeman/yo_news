import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ALLOWED_KEYS,
  type SettingKey,
  type SettingSource,
} from "@/lib/settings-keys";

export {
  ALLOWED_KEYS,
  FIELD_BY_NAME,
  isAllowedKey,
  maskSecret,
  toView,
  type SettingKey,
  type SettingSource,
  type SettingView,
} from "@/lib/settings-keys";

/**
 * Editor-managed settings, resolved from the database with the environment as a
 * fallback.
 *
 * The point is that a key pasted into /admin/settings takes effect on the next
 * request, with no .env edit and no pm2 restart: everything reads through
 * `getSetting` at call time rather than caching `process.env` at module load.
 * The allowlist and masking live in settings-keys.ts, which this module re-exports
 * so callers have one import.
 */

/**
 * Resolves one setting: the database row wins, then the environment, then empty.
 *
 * An empty string in the row counts as absent. It has to — otherwise clearing the
 * field in the form would store "" and permanently mask a perfectly good .env
 * key with nothing, which is indistinguishable from "broken" when debugging.
 */
export async function getSetting(key: string): Promise<string> {
  const resolved = await resolveSetting(key);
  return resolved.value;
}

/** As `getSetting`, plus the provenance the settings page displays. */
export async function resolveSetting(
  key: string,
): Promise<{ value: string; source: SettingSource }> {
  const row = await prisma.appSetting.findUnique({
    where: { key },
    select: { value: true },
  });

  const stored = row?.value.trim() ?? "";
  if (stored) return { value: stored, source: "database" };

  const fromEnv = process.env[key]?.trim() ?? "";
  if (fromEnv) return { value: fromEnv, source: "environment" };

  return { value: "", source: "unset" };
}

/** Every allowed key with its provenance, in one pass. */
export async function resolveAllSettings(): Promise<
  Record<SettingKey, { value: string; source: SettingSource }>
> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...ALLOWED_KEYS] } },
    select: { key: true, value: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.value.trim()]));

  // Built by hand rather than via Object.fromEntries typing gymnastics; the key
  // list is two entries and this keeps the result type exact.
  const result = {} as Record<SettingKey, { value: string; source: SettingSource }>;
  for (const key of ALLOWED_KEYS) {
    const value = stored.get(key) ?? "";
    if (value) {
      result[key] = { value, source: "database" };
      continue;
    }
    const fromEnv = process.env[key]?.trim() ?? "";
    result[key] = { value: fromEnv, source: fromEnv ? "environment" : "unset" };
  }
  return result;
}

/**
 * Stores an override, or clears it when `value` is empty.
 *
 * Clearing deletes the row rather than storing "": see `getSetting`. Returns
 * whether a row now exists, which the route reports as `isSet`.
 */
export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<{ stored: boolean }> {
  const trimmed = value.trim();

  if (!trimmed) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return { stored: false };
  }

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: trimmed },
    update: { value: trimmed },
  });

  return { stored: true };
}