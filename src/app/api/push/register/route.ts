import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Регистрация push-токена устройства.
 *
 * Приложение (Capacitor + RuStore Push SDK) получает токен при первом запуске и присылает его
 * сюда; редакция позже рассылает по этим токенам уведомления. Эндпоинт только пишет токен — он
 * не рассылает ничего, поэтому не требует секрета RuStore и не даёт утечки.
 *
 * `upsert` по уникальному токену, а не `create`: одно устройство может зарегистрироваться
 * повторно (переустановка, обновление токена SDK), и повторная запись должна быть тихой и
 * идемпотентной, а не падать на нарушении уникальности.
 *
 * Публичный и анонимный намеренно: у приложения нет учётных записей, токен устройства — это всё,
 * что оно может предъявить, и требовать больше значило бы просто не собирать токены. Ответ всегда
 * 200 на валидный токен и 400 на мусор; тело ответа ничего не раскрывает.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ожидается JSON." }, { status: 400 });
  }

  const token = typeof (payload as { token?: unknown })?.token === "string"
    ? (payload as { token: string }).token.trim()
    : "";
  const platformRaw = (payload as { platform?: unknown })?.platform;
  const platform =
    typeof platformRaw === "string" && platformRaw.trim().length > 0
      ? platformRaw.trim().slice(0, 32)
      : "rustore";

  // RuStore push-токены — длинные непрозрачные строки. Нижняя граница отсекает пустой ввод и
  // обрывки, верхняя — заведомо мусорный размер.
  if (token.length < 8 || token.length > 512) {
    return NextResponse.json({ ok: false, error: "Некорректный токен." }, { status: 400 });
  }

  await prisma.pushToken.upsert({
    where: { token },
    create: { token, platform },
    update: { platform },
  });

  return NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
