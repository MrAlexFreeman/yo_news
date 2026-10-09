import { NextResponse } from "next/server";

import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * "Тест подключения" for the settings form.
 *
 * Verifies a key against the cheapest endpoint that still authenticates, rather
 * than against the model: a real DeepInfra FLUX call would cost money and take
 * seconds just to tell an editor their key is wrong. DeepSeek's balance endpoint
 * and DeepInfra's model list both validate a bearer token for free.
 *
 * Under /api/admin/, so Basic Auth applies. Requires JSON like the other settings
 * routes: a cross-origin form must not be able to send the key to a third party
 * by way of a form action pointing here.
 */

const TIMEOUT_MS = 15_000;

/**
 * A fal queue URL for a request id that cannot exist.
 *
 * Used only to prove a key is accepted, so it must cost nothing: the queue authenticates
 * before it looks anything up and answers 404 for an unknown id once the key is good. See the
 * `ENDPOINTS` note for why fal is the one provider whose success is not a 2xx.
 */
const FAL_STATUS_PROBE =
  "https://queue.fal.run/fal-ai/esrgan/requests/00000000-0000-4000-8000-000000000000/status";

type Provider = "deepseek" | "deepinfra" | "vk" | "fal";

/**
 * Key → { setting, free validation endpoint }.
 *
 * `user/balance` for DeepSeek returns account credit and fails with 401 for a bad
 * key. `v1/models` is DeepInfra's OpenAI-compatible listing, which authenticates
 * the token and lists no billable work. `users.get` with `fields=screen_name`
 * is VK's cheapest authenticated call — it returns the token holder's name and
 * costs nothing.
 *
 * All three report success through a 2xx rather than through a body shape, so a
 * provider changing its payload cannot turn a working key into a red field.
 *
 * fal is the exception and the reason it has its own branch: its queue authenticates
 * *before* it looks anything up, so asking about a request id that does not exist answers
 * 401 for a bad key and 404 for a good one. There is no 2xx to wait for without spending
 * money on a real inference, and a button whose purpose is to avoid spending money should not
 * be the thing that spends it. `interpret` therefore treats 404 as success for fal alone.
 */
const ENDPOINTS: Record<
  Provider,
  {
    setting:
      | "DEEPSEEK_API_KEY"
      | "DEEPINFRA_API_KEY"
      | "VK_ACCESS_TOKEN"
      | "FAL_API_KEY";
    url: (token: string) => string;
    /** Auth style: fal reads `Authorization: Key`, the others a bearer token. */
    scheme: "bearer" | "key";
  }
> = {
  deepseek: {
    setting: "DEEPSEEK_API_KEY",
    url: () => "https://api.deepseek.com/user/balance",
    scheme: "bearer",
  },
  deepinfra: {
    setting: "DEEPINFRA_API_KEY",
    url: () => "https://api.deepinfra.com/v1/models",
    scheme: "bearer",
  },
  vk: {
    setting: "VK_ACCESS_TOKEN",
    url: (token) =>
      `https://api.vk.com/method/users.get?fields=screen_name&v=5.199&access_token=${encodeURIComponent(token)}`,
    scheme: "bearer",
  },
  fal: {
    setting: "FAL_API_KEY",
    // A random id that cannot exist: the answer is about the key, not the request.
    url: () => `${FAL_STATUS_PROBE}`,
    scheme: "key",
  },
};

const SUCCESS_MESSAGE: Record<Provider, string> = {
  deepseek: "Ключ принят, DeepSeek отвечает.",
  deepinfra: "Ключ принят, DeepInfra отвечает.",
  vk: "Токен принят, ВК отвечает.",
  fal: "Ключ принят, fal.ai отвечает.",
};

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

/**
 * VK answers 200 even for a rejected token, with an `error` object in the body.
 * A status-only check would therefore report a dead token as working, which is
 * the one outcome this button exists to prevent.
 */
async function vkErrorInBody(response: Response): Promise<string | null> {
  if (!response.headers.get("content-type")?.includes("json")) return null;

  const payload = (await response.json().catch(() => null)) as
    | { error?: { error_code?: number; error_msg?: string } }
    | null;

  if (!payload?.error) return null;
  return `ВК отклонил токен: ${payload.error.error_msg ?? "неизвестная ошибка"} (${
    payload.error.error_code ?? "?"
  })`;
}

/** Turns a status into an outcome the form can render as a sentence. */
function interpret(provider: Provider, status: number): { ok: boolean; message: string } {
  /*
    fal only. Measured, not assumed: this endpoint answers 404 unauthenticated and 401 with a
    wrong key, so 404 is what a valid key gets for an unknown request. Reading it as failure
    would leave a correct key permanently red, and reading it as success unconditionally would
    be wrong for every other provider — hence the narrow branch rather than a special case
    bolted onto the 200 check.
  */
  if (provider === "fal" && status === 404) {
    return { ok: true, message: SUCCESS_MESSAGE[provider] };
  }

  if (status === 200) {
    return { ok: true, message: SUCCESS_MESSAGE[provider] };
  }
  if (status === 401 || status === 403) {
    return { ok: false, message: "Ключ отклонён провайдером — проверьте его целиком." };
  }
  if (status === 429) {
    return { ok: false, message: "Провайдер отклонил запрос по частоте. Попробуйте позже." };
  }
  return {
    ok: false,
    message: `Провайдер ответил ${status}. Сеть работает, но результат неожиданный.`,
  };
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: { provider?: unknown; key?: unknown };
  try {
    body = (await request.json()) as { provider?: unknown; key?: unknown };
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const provider = body.provider as Provider;
  if (
    provider !== "deepseek" &&
    provider !== "deepinfra" &&
    provider !== "vk" &&
    provider !== "fal"
  ) {
    return NextResponse.json(
      {
        error:
          "Неизвестный провайдер: ожидается deepseek, deepinfra, vk или fal.",
      },
      { status: 400 },
    );
  }

  // A key typed into the form wins over the stored one — that is the whole point
  // of the button: check what you just pasted, before saving it.
  const typed = typeof body.key === "string" ? body.key.trim() : "";
  const key = typed || (await getSetting(ENDPOINTS[provider].setting));

  if (!key) {
    return NextResponse.json(
      { error: "Ключ не задан: введите его в поле или сохраните настройку." },
      { status: 400 },
    );
  }

  const { url, scheme } = ENDPOINTS[provider];

  try {
    // VK carries the token in the query string, so it must not also be sent as a
    // bearer header it does not read. fal reads `Key` rather than `Bearer`.
    const response =
      provider === "vk"
        ? await fetch(url(key), { signal: AbortSignal.timeout(TIMEOUT_MS) })
        : await fetch(url(key), {
            headers: {
              Authorization:
                scheme === "key" ? `Key ${key}` : `Bearer ${key}`,
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });

    const outcome = interpret(provider, response.status);

    if (provider === "vk" && outcome.ok) {
      const bodyError = await vkErrorInBody(response);
      if (bodyError) {
        return NextResponse.json(
          { ok: false, message: bodyError, status: 200 },
          { status: 200 },
        );
      }
    }

    return NextResponse.json({ ...outcome, status: response.status }, { status: 200 });
  } catch (error) {
    // A timeout or DNS failure means the key is not what is wrong; saying so is
    // more useful than a generic failure.
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    return NextResponse.json(
      {
        ok: false,
        message: timedOut
          ? "Провайдер не ответил за 15 секунд. Проверьте соединение и попробуйте ещё раз."
          : `Не удалось обратиться к провайдеру: ${
              error instanceof Error ? error.message : "сетевая ошибка"
            }`,
      },
      { status: 200 },
    );
  }
}