import { NextResponse } from "next/server";

import { getSetting } from "@/lib/settings";
import { checkMaxToken, sendMaxTestMessage, type MaxConfig } from "@/lib/max-publisher";
import {
  checkTelegramToken,
  pingTelegramEndpoint,
  sendTelegramTestMessage,
  telegramProxy,
  type TelegramConfig,
} from "@/lib/telegram-publisher";

export const runtime = "nodejs";

/**
 * "Тестовая отправка" for the syndication settings.
 *
 * Three levels, because an editor who cannot get a post out has three different
 * possible faults and one button cannot tell them apart:
 *
 *  - `mode: "ping"` reaches the API root and reports the HTTP status and the response
 *    time. No token is sent, so it answers "can this host talk to that endpoint at
 *    all" — the question that actually failed in production, where TCP 443 to
 *    api.telegram.org never completes. A 404 from Telegram counts as success here:
 *    the point is that something answered.
 *  - `mode: "token"` calls the cheapest authenticated endpoint and posts nothing.
 *    This is what "is my token valid" means, and it costs nothing.
 *  - `mode: "message"` actually posts to the channel. A valid token with the wrong
 *    chat id fails here and nowhere else — `getMe` is perfectly happy with a bot that
 *    has never been added to any channel.
 *
 * The typed values win over the stored ones, which is the point of the button: check
 * what was just pasted, before saving it. Under /api/admin/, so Basic Auth applies;
 * `POST` requires JSON so a cross-origin form cannot drive this.
 *
 * Unlike the VK settings test, `message` really does publish something, because the
 * destination is a channel and there is no way to prove a chat id works without
 * writing to it. The text says so on its face and `mode` is explicit, so no button
 * fires it by accident.
 */

type Messenger = "telegram" | "max";

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: {
    messenger?: unknown;
    mode?: unknown;
    token?: unknown;
    destination?: unknown;
    apiRoot?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const messenger = body.messenger as Messenger;
  if (messenger !== "telegram" && messenger !== "max") {
    return NextResponse.json(
      { error: "Неизвестный мессенджер: ожидается telegram или max." },
      { status: 400 },
    );
  }

  // Anything other than an explicit mode stays a read-only check, so a client that
  // forgets the field cannot accidentally publish.
  const mode =
    body.mode === "message" ? "message" : body.mode === "ping" ? "ping" : "token";

  const typedToken = typeof body.token === "string" ? body.token.trim() : "";
  const typedDestination = typeof body.destination === "string" ? body.destination.trim() : "";
  const typedApiRoot = typeof body.apiRoot === "string" ? body.apiRoot.trim() : "";

  const tokenKey = messenger === "telegram" ? "TELEGRAM_BOT_TOKEN" : "MAX_BOT_TOKEN";
  const destinationKey = messenger === "telegram" ? "TELEGRAM_CHANNEL_ID" : "MAX_CHAT_ID";

  // The ping needs neither a token nor a channel: it is about the endpoint, and
  // requiring a credential to test connectivity would make the button useless exactly
  // when someone is trying to find out whether the endpoint works before pasting one.
  if (mode === "ping") {
    if (messenger !== "telegram") {
      return NextResponse.json(
        { error: "Проверка эндпоинта есть только для Telegram." },
        { status: 400 },
      );
    }

    const config: TelegramConfig = {
      token: "",
      channelId: "",
      enabled: true,
      apiRoot: typedApiRoot || (await getSetting("TELEGRAM_API_ROOT")),
    };

    return NextResponse.json({ ...(await pingTelegramEndpoint(config)), mode });
  }

  const token = typedToken || (await getSetting(tokenKey));
  const destination = typedDestination || (await getSetting(destinationKey));

  if (!token) {
    return NextResponse.json(
      { error: "Токен не задан: введите его в поле или сохраните настройку." },
      { status: 400 },
    );
  }

  if (mode === "token") {
    const outcome =
      messenger === "telegram"
        ? await checkTelegramToken({
            token,
            channelId: destination,
            enabled: true,
            apiRoot: typedApiRoot || (await getSetting("TELEGRAM_API_ROOT")),
          })
        : await checkMaxToken(token);
    return NextResponse.json({ ...outcome, mode });
  }

  if (!destination) {
    return NextResponse.json(
      { error: "Канал не задан: введите его в поле или сохраните настройку." },
      { status: 400 },
    );
  }

  const config: TelegramConfig | MaxConfig =
    messenger === "telegram"
      ? {
          token,
          channelId: destination,
          enabled: true,
          apiRoot: typedApiRoot || (await getSetting("TELEGRAM_API_ROOT")),
        }
      : { token, chatId: destination, enabled: true };

  /*
    The stored enabled flag is deliberately not consulted: the button is an explicit
    request to send, and an editor who turned auto-posting off and is now checking
    that the credentials still work is doing exactly the right thing. Refusing would
    make the button useless in the one situation it is most likely to be used in.
  */
  const outcome =
    messenger === "telegram"
      ? await sendTelegramTestMessage(config as TelegramConfig)
      : await sendMaxTestMessage(config as MaxConfig);

  // Reported so the UI can say whether the request left through a proxy — the answer
  // changes the interpretation of a failure, and the proxy is env-only so the page
  // cannot otherwise know.
  return NextResponse.json({ ...outcome, mode, viaProxy: telegramProxy().length > 0 });
}
