import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  LIVE_STREAM_DEFAULT_TITLE,
  resolveLiveStreamHref,
  resolveLiveStreamTitle,
  toLiveStreamView,
  validateLiveStreamTitle,
  validateLiveStreamUrl,
} from "@/lib/live-stream";
import { resolveAllSettings, setSetting } from "@/lib/settings";
import { LIVE_STREAM_FIELDS, type LiveStreamFieldName } from "@/lib/settings-keys";

export const runtime = "nodejs";
/** Reads live rows; a cached response would show the state from before the save. */
export const dynamic = "force-dynamic";

/**
 * Reads and writes the «Прямой эфир» badge settings.
 *
 * A third route beside the API keys and the messengers, because these three fields are
 * neither of the other two: they are not secrets to be masked, and they are not destinations
 * to be validated as tokens. The URL is the reason this cannot be folded into
 * `/api/admin/syndication` — that route's `url` kind means "the API root a bot token is
 * sent to", which must be an absolute https origin and may never be a path. Here a
 * site-relative path is the *common* case, and the risk runs the other way: the stored value
 * becomes an `href` in the masthead of every page, so a `javascript:` URL would be a script
 * running in this site's origin for every reader who clicks it.
 *
 * Under `/api/admin/`, so `src/proxy.ts` requires Basic Auth first, and `POST` requires
 * `application/json` so a cross-origin form cannot write the field.
 */

/** What the form renders from. Never carries anything masked, because nothing here is secret. */
type State = {
  enabled: boolean;
  url: string;
  title: string;
};

async function buildState(): Promise<State> {
  const resolved = await resolveAllSettings();

  return {
    /*
     * The stored URL is echoed verbatim rather than through `resolveLiveStreamHref`. The
     * editor has to see what is actually stored in order to fix it — showing the resolved
     * value would print `null` for an unsafe URL and leave them with no way to tell a bad
     * value from a missing one. Whether it is *safe* is decided again on read, at render
     * time, which is the check that actually matters.
     */
    enabled: toLiveStreamView({
      enabled: resolved.LIVE_STREAM_ENABLED.value,
      url: resolved.LIVE_STREAM_URL.value,
      title: resolved.LIVE_STREAM_TITLE.value,
    }).enabled,
    url: resolved.LIVE_STREAM_URL.value,
    title: resolved.LIVE_STREAM_TITLE.value,
  };
}

export async function GET() {
  const resolved = await resolveAllSettings();
  const view = toLiveStreamView({
    enabled: resolved.LIVE_STREAM_ENABLED.value,
    url: resolved.LIVE_STREAM_URL.value,
    title: resolved.LIVE_STREAM_TITLE.value,
  });

  return NextResponse.json({
    liveStream: { ...(await buildState()), href: view.href, label: view.title },
  });
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

  const updates = new Map<LiveStreamFieldName, string>();
  const errors: Record<string, string> = {};

  for (const [name, value] of Object.entries(payload)) {
    if (!LIVE_STREAM_FIELDS[name as LiveStreamFieldName]) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === "boolean") {
      // The form sends "true"/"false"; a boolean in the body is unambiguous and cheaper to
      // accept than to reject. `setSetting` stores the string form either way.
      updates.set(name as LiveStreamFieldName, value ? "true" : "false");
      continue;
    }

    if (typeof value !== "string") {
      errors[name] = "Ожидается строка.";
      continue;
    }

    const trimmed = value.trim();

    /*
     * A flag has no validation, and the two text fields each have their own — the URL one
     * being the load-bearing check in this file. Empty stays valid for all three: it clears
     * the override, and for the flag that means "off", which is a real state rather than a
     * missing value.
     */
    const problem =
      name === "liveStreamUrl"
        ? validateLiveStreamUrl(trimmed)
        : name === "liveStreamTitle"
          ? validateLiveStreamTitle(trimmed)
          : null;

    if (problem) {
      errors[name] = problem;
      continue;
    }

    updates.set(name as LiveStreamFieldName, trimmed);
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
    await setSetting(LIVE_STREAM_FIELDS[name].key, value);
  }

  /*
   * Purge the public shell rather than naming pages.
   *
   * The badge lives in `src/app/(public)/layout.tsx`, so every public page renders it from
   * that one layout, and the pages themselves are ISR'd at `revalidate = 300`. Revalidating
   * `"/"` alone would fix the front page and leave the category, tag, forum and news pages
   * showing the old badge for up to five minutes — an editor who turns the stream on would
   * see it appear on the home page and nowhere else, which reads as a bug rather than a
   * cache. `"/(public)", "layout"` invalidates that layout and everything beneath it in one
   * call, which is the unit that actually changed.
   */
  try {
    revalidatePath("/(public)", "layout");
  } catch {
    // Outside a request (a test importing this module) there is no static generation store.
    // The write is already committed at this point, so failing to revalidate costs freshness
    // on the next natural revalidation and nothing else. Swallowing it here is deliberate:
    // losing the save because a cache could not be purged would be strictly worse.
  }

  const resolved = await resolveAllSettings();
  const view = toLiveStreamView({
    enabled: resolved.LIVE_STREAM_ENABLED.value,
    url: resolved.LIVE_STREAM_URL.value,
    title: resolved.LIVE_STREAM_TITLE.value,
  });

  return NextResponse.json({
    ok: true,
    saved: [...updates.keys()],
    liveStream: {
      enabled: view.enabled,
      url: resolved.LIVE_STREAM_URL.value,
      title: resolved.LIVE_STREAM_TITLE.value,
      href: view.href,
      label: view.title,
    },
    // Repeated here rather than imported by the form: the component should not have to know
    // that an unset label means this particular string.
    defaultTitle: LIVE_STREAM_DEFAULT_TITLE,
  });
}