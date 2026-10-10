import { NextResponse } from "next/server";

import { isValidEntitySlug, validateEntityCard } from "@/lib/entity-card";
import {
  countEntityCardUsages,
  createEntityCard,
  deleteEntityCard,
  listEntityCards,
  updateEntityCard,
} from "@/lib/entities";

export const runtime = "nodejs";
/** Reads rows and writes them; a cached answer would show a stale desk. */
export const dynamic = "force-dynamic";

/**
 * `/api/admin/entities` — the reference desk.
 *
 * Under `/api/admin/`, so the matcher in `src/proxy.ts` requires Basic Auth before any of
 * this runs. `POST`, `PATCH` and `DELETE` additionally require `application/json`: a form
 * can only send urlencoded, multipart or text-plain, and such a body is not valid JSON,
 * while a cross-origin JSON request needs a preflight no CORS header here permits. That is
 * the same guard the settings route uses, and the same reason.
 */

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET — the list, with the editor's search folded in JS (SQLite folds ASCII only). */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("q") ?? undefined;
  const cards = await listEntityCards(search);

  return NextResponse.json({ cards });
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  const body = await readBody(request);
  if (!body) {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const { errors, value } = validateEntityCard(body);
  if (!value) {
    return NextResponse.json({ error: "Проверьте поля.", fieldErrors: errors }, { status: 400 });
  }

  try {
    const row = await createEntityCard(value);
    return NextResponse.json({ ok: true, card: row }, { status: 201 });
  } catch (error) {
    /*
      A duplicate slug is the editor's most likely mistake — the address is generated from
      the title, and two cards with similar names produce the same one — and it deserves a
      sentence rather than Prisma's message, which names the constraint in English.
    */
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: "Карточка с таким адресом уже есть.",
          fieldErrors: { slug: "Этот адрес уже занят." },
        },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается PATCH с Content-Type: application/json." },
      { status: 415 },
    );
  }

  const body = await readBody(request);
  if (!body) {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  /*
    `from` is the card being edited and `slug` is where it is going.
    Two fields rather than one on purpose: the address is editable, and an editor who
    corrects a transliteration expects the card to move. With a single field a rename is
    silently impossible — the route would look the card up under the new address, not find
    it, and answer 404 for a card that is plainly on screen.
  */
  const current = typeof body.from === "string" ? body.from.trim() : "";
  if (!isValidEntitySlug(current)) {
    return NextResponse.json(
      { error: "Не указан адрес существующей карточки." },
      { status: 400 },
    );
  }

  const { errors, value } = validateEntityCard(body);
  if (!value) {
    return NextResponse.json({ error: "Проверьте поля.", fieldErrors: errors }, { status: 400 });
  }

  try {
    const row = await updateEntityCard(current, value);
    return NextResponse.json({ ok: true, card: row });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: "Карточка с таким адресом уже есть.",
          fieldErrors: { slug: "Этот адрес уже занят." },
        },
        { status: 409 },
      );
    }
    // Prisma's "record not found" is P2025; anything else is a real fault.
    if (isMissingRecord(error)) {
      return NextResponse.json({ error: "Карточка не найдена." }, { status: 404 });
    }
    throw error;
  }
}

/**
 * DELETE — removes a card, after saying what depends on it.
 *
 * The usage count is not a confirmation dialog. A card is referenced by its address from
 * whatever articles already link it, and those bodies are HTML: nothing cascades, so
 * deleting quietly leaves dead links in published stories. The count is what lets the
 * editor decide rather than discover.
 */
export async function DELETE(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается DELETE с Content-Type: application/json." },
      { status: 415 },
    );
  }

  const body = await readBody(request);
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!isValidEntitySlug(slug)) {
    return NextResponse.json({ error: "Не указан адрес карточки." }, { status: 400 });
  }

  const removed = await deleteEntityCard(slug);
  if (!removed) {
    return NextResponse.json({ error: "Карточка не найдена." }, { status: 404 });
  }

  const usedIn = await countEntityCardUsages(slug);

  return NextResponse.json({
    ok: true,
    removed: slug,
    usedIn,
    // Stated rather than acted on: rewriting published bodies is not this endpoint's job,
    // and an editor who is told "12 articles still link it" can decide what to do.
    warning: usedIn > 0
      ? `На карточку ссылаются материалы (${usedIn}). Ссылки в них останутся, пока вы не замените их.`
      : null,
  });
}

/** Prisma's unique-constraint code. Matched as a string so the import stays out of here. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/** Prisma's record-not-found code. */
function isMissingRecord(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2025";
}