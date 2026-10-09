import { NextResponse } from "next/server";

import {
  FIELD_BY_NAME,
  type SettingKey,
  isAllowedKey,
  toView,
  validateApiKeyField,
} from "@/lib/settings-keys";
import { resolveAllSettings, setSetting } from "@/lib/settings";

type FieldName = keyof typeof FIELD_BY_NAME;

export const runtime = "nodejs";
/** Reads live rows; a cached response would show a stale key after a save. */
export const dynamic = "force-dynamic";

/**
 * Reads and writes editor-managed settings.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts requires Basic Auth before
 * this handler runs. `POST` additionally requires application/json, which is what
 * stops a cross-origin form from storing an attacker-supplied key: a form can
 * only send urlencoded/multipart/text-plain, and such a body is not valid JSON,
 * while a cross-origin JSON fetch needs a preflight that no CORS header permits.
 */

/**
 * The charset rules live in `settings-keys.ts`, not here.
 *
 * They used to be a private `KEY_PATTERN` in this file, which is why nothing tested them: a
 * route importing `server-only` and Prisma cannot be loaded by a check, so the one field
 * whose provider issues a colon was refused by every key the editor could legitimately paste,
 * and the suite stayed green. The validators are now beside the other pure ones — length and
 * charset together, so no caller can enforce one without the other — and are asserted
 * directly.
 */

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

/**
 * Why this route walks `FIELD_BY_NAME` and not the allowlist.
 *
 * It used to walk `ALLOWED_KEYS`, which put every key with no name in the map into
 * `settings["undefined"]` — so all seven messenger keys collapsed into one property and the
 * last one won. The three API-key fields stayed correct, which is exactly why nothing
 * noticed. The map is gone rather than repaired: nothing reads the reverse form, and leaving a
 * reverse map here is what invited the mistake in the first place.
 */

/**
 * GET → the current state of every API-key setting, with keys masked.
 *
 * Walking `FIELD_BY_NAME` rather than naming each field: the previous version listed them one
 * by one, which meant adding VK_ACCESS_TOKEN required three coordinated edits and the third
 * was easy to forget — a silently missing field reads as "this setting has no UI", not as a
 * mistake. See `NAME_BY_KEY` for why the allowlist is not walked instead.
 */
export async function GET() {
  const resolved = await resolveAllSettings();

  const settings: Record<string, ReturnType<typeof toView>> = {};
  for (const [name, key] of Object.entries(FIELD_BY_NAME)) {
    settings[name] = toView(resolved[key]);
  }

  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  // Only fields named in FIELD_BY_NAME are read, and only for keys on the
  // allowlist. Anything else in the body is ignored rather than persisted.
  const updates = new Map<SettingKey, string>();
  const errors: Record<string, string> = {};

  for (const [name, value] of Object.entries(payload)) {
    const key = FIELD_BY_NAME[name];
    if (!key || !isAllowedKey(key)) continue;

    if (value === null || value === undefined) continue;

    if (typeof value !== "string") {
      errors[name as FieldName] = "Ожидается строка.";
      continue;
    }

    // Trimmed here as well as in the form. The field is a password input, and a key pasted
    // from a dashboard or a password manager very often arrives with a trailing newline or
    // a space; without this the value would be stored with it, and a stored trailing space
    // is indistinguishable from a wrong key at the provider — the request fails with a
    // message about authentication while the editor is looking at a correct one.
    const trimmed = value.trim();

    // Empty clears the override so the .env value takes over again. Reported
    // separately from a validation error because it is a legitimate action.
    if (!trimmed) {
      updates.set(key, "");
      continue;
    }

    const problem = validateApiKeyField(name, trimmed);
    if (problem) {
      errors[name as FieldName] = problem;
      continue;
    }

    updates.set(key, trimmed);
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "Проверьте поля.", fieldErrors: errors },
      { status: 400 },
    );
  }

  if (updates.size === 0) {
    return NextResponse.json(
      { error: "Нечего сохранять: ни одно поле не заполнено." },
      { status: 400 },
    );
  }

  for (const [key, value] of updates) {
    await setSetting(key, value);
  }

  // Re-read rather than echo the input: `source` and `isSet` after a clear must
  // reflect whatever the environment now supplies, which the client cannot know.
  const after = await resolveAllSettings();

  const settings: Record<string, ReturnType<typeof toView>> = {};
  for (const [name, key] of Object.entries(FIELD_BY_NAME)) {
    settings[name] = toView(after[key]);
  }

  return NextResponse.json({
    ok: true,
    saved: [...updates.keys()],
    cleared: [...updates.entries()].filter(([, value]) => !value).map(([key]) => key),
    settings,
  });
}