import { NextResponse } from "next/server";

import {
  ALLOWED_KEYS,
  FIELD_BY_NAME,
  type SettingKey,
  isAllowedKey,
  toView,
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

/** Long enough to reject an obvious typo, short enough to reject a pasted page. */
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 300;

/**
 * Token charset only: no spaces, no quotes, no control characters.
 *
 * This is not format validation for a specific provider — both vendors issue
 * opaque strings and guessing a prefix would reject valid keys on a change. It is
 * a check that the field holds one token and not a sentence someone pasted by
 * accident, which would fail confusingly at the provider instead.
 */
const KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

/** Setting key → the request field name that carries it, the reverse of the map. */
const NAME_BY_KEY = Object.fromEntries(
  Object.entries(FIELD_BY_NAME).map(([name, key]) => [key, name]),
) as Record<SettingKey, FieldName>;

/**
 * GET → the current state of every allowed setting, with keys masked.
 *
 * Built by walking ALLOWED_KEYS rather than naming each field. The previous
 * version listed them one by one, which meant adding VK_ACCESS_TOKEN required
 * three coordinated edits and the third one was easy to forget — a silently
 * missing field reads as "this setting has no UI", not as a mistake.
 */
export async function GET() {
  const resolved = await resolveAllSettings();

  const settings: Record<string, ReturnType<typeof toView>> = {};
  for (const key of ALLOWED_KEYS) {
    settings[NAME_BY_KEY[key]] = toView(resolved[key]);
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

    const trimmed = value.trim();

    // Empty clears the override so the .env value takes over again. Reported
    // separately from a validation error because it is a legitimate action.
    if (!trimmed) {
      updates.set(key, "");
      continue;
    }

    if (trimmed.length < MIN_KEY_LENGTH) {
      errors[name as FieldName] = `Ключ слишком короткий — минимум ${MIN_KEY_LENGTH} символов.`;
      continue;
    }
    if (trimmed.length > MAX_KEY_LENGTH) {
      errors[name as FieldName] = "Ключ слишком длинный — проверьте, что вставили ключ целиком.";
      continue;
    }
    if (!KEY_PATTERN.test(trimmed)) {
      errors[name as FieldName] =
        "Ключ содержит пробелы или недопустимые символы. Нужен один непрерывный токен без кавычек.";
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
  for (const key of ALLOWED_KEYS) {
    settings[NAME_BY_KEY[key]] = toView(after[key]);
  }

  return NextResponse.json({
    ok: true,
    saved: [...updates.keys()],
    cleared: [...updates.entries()].filter(([, value]) => !value).map(([key]) => key),
    settings,
  });
}