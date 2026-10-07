import { NextResponse } from "next/server";

import { resolveAllSettings, setSetting } from "@/lib/settings";
import {
  DEFAULT_SYNDICATION_ENABLED,
  parseEnabled,
  SYNDICATION_FIELDS,
  toView,
  validateSyndicationField,
  type SyndicationField,
  type SyndicationFieldName,
} from "@/lib/settings-keys";

export const runtime = "nodejs";
/** Reads live rows; a cached response would show a stale token after a save. */
export const dynamic = "force-dynamic";

/**
 * Reads and writes the Telegram and MAX auto-posting settings.
 *
 * A separate route from /api/admin/settings, not because the settings are secret —
 * the tokens here are as secret as the API keys — but because the *fields* are not
 * tokens. A destination is "@eartnews" or "-1001234", and a flag is "true". Both are
 * rejected by the token validator, which is the right validator for exactly one of
 * the three kinds of value in this project. Rather than loosening that validator for
 * everyone, each field declares its own kind (see SYNDICATION_FIELDS) and is checked
 * against it here.
 *
 * Both routes sit under /api/admin/, so the matcher in src/proxy.ts requires Basic
 * Auth first. `POST` requires application/json like its sibling, which is what stops
 * a cross-origin form from storing an attacker-supplied token: a form can only send
 * urlencoded/multipart/text-plain, none of which is valid JSON, while a cross-origin
 * JSON fetch needs a preflight no CORS header here permits.
 */

/**
 * What the form needs to render both blocks, with no token value in it.
 *
 * Both destinations are called `destination` even though the settings keys behind
 * them are `TELEGRAM_CHANNEL_ID` and `MAX_CHAT_ID`. The form renders two structurally
 * identical blocks from one loop, and a per-provider field name there meant the
 * spread of the save response wrote `channelId` next to `destination` and left the
 * field showing its pre-save value — which reads as "the save did nothing".
 */
type State = {
  telegram: {
    token: ReturnType<typeof toView>;
    destination: string;
    enabled: boolean;
    /** Alternative Bot API root; empty means the official one. */
    apiRoot: string;
  };
  max: {
    token: ReturnType<typeof toView>;
    destination: string;
    enabled: boolean;
  };
};

async function buildState(): Promise<State> {
  const resolved = await resolveAllSettings();

  return {
    telegram: {
      token: toView(resolved.TELEGRAM_BOT_TOKEN),
      destination: resolved.TELEGRAM_CHANNEL_ID.value,
      enabled: parseEnabled(
        resolved.TELEGRAM_ENABLED.value,
        DEFAULT_SYNDICATION_ENABLED.telegram,
      ),
      apiRoot: resolved.TELEGRAM_API_ROOT.value,
    },
    max: {
      token: toView(resolved.MAX_BOT_TOKEN),
      destination: resolved.MAX_CHAT_ID.value,
      enabled: parseEnabled(resolved.MAX_ENABLED.value, DEFAULT_SYNDICATION_ENABLED.max),
    },
  };
}

export async function GET() {
  return NextResponse.json({ syndication: await buildState() });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
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

  const updates = new Map<SyndicationFieldName, string>();
  const errors: Record<string, string> = {};

  for (const [name, value] of Object.entries(payload)) {
    const field = SYNDICATION_FIELDS[name as SyndicationFieldName];
    if (!field) continue;

    if (value === null || value === undefined) continue;

    if (typeof value === "boolean") {
      // The form sends "true"/"false", but a boolean in the body is unambiguous and
      // cheaper to accept than to reject — `setSetting` stores the string form anyway.
      updates.set(name as SyndicationFieldName, value ? "true" : "false");
      continue;
    }

    if (typeof value !== "string") {
      errors[name] = "Ожидается строка.";
      continue;
    }

    const trimmed = value.trim();
    const problem = validateSyndicationField(field, trimmed);
    if (problem) {
      errors[name] = problem;
      continue;
    }

    updates.set(name as SyndicationFieldName, trimmed);
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "Проверьте поля.", fieldErrors: errors },
      { status: 400 },
    );
  }

  if (updates.size === 0) {
    return NextResponse.json(
      { error: "Нечего сохранять: ни одно поле не изменено." },
      { status: 400 },
    );
  }

  for (const [name, value] of updates) {
    const field: SyndicationField = SYNDICATION_FIELDS[name];
    await setSetting(field.key, value);
  }

  /*
    Re-read rather than echo the input. Two things only the server knows: whether an
    emptied field fell back to a `.env` value or to nothing at all, and what a flag
    resolved to when it was absent. Rendering the form from the request would put the
    page and the database out of step in exactly the case an editor is trying to read.
  */
  return NextResponse.json({
    ok: true,
    saved: [...updates.keys()],
    cleared: [...updates.entries()]
      .filter(([, value]) => !value)
      .map(([name]) => name),
    syndication: await buildState(),
  });
}