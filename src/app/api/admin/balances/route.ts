import { NextResponse } from "next/server";

import {
  formatMoney,
  notConfigured,
  parseDeepinfraBalance,
  parseDeepseekBalance,
  type ProviderBalance,
} from "@/lib/balance-format";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
/** Reads live balances; a cached one would show yesterday's credit. */
export const dynamic = "force-dynamic";

/**
 * Remaining credit on the two providers that bill the newsroom per generation.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts applies Basic Auth before this
 * runs. A balance is a number an outsider could use to time an attack on the account,
 * and there is no reason for it to be readable without credentials.
 *
 * GET only and deliberately cheap: both are account reads, not billable work. The
 * badge next to "Тест подключения" is read on every settings page load, so it must
 * not cost anything or take long.
 */

/**
 * Four seconds, not the fifteen the connection test allows.
 *
 * This one sits in the middle of rendering the settings page and again in the cover
 * panel, so a slow provider must not hold the editor waiting. The endpoint is a
 * single account read on both services; four seconds is generous for it.
 */
const TIMEOUT_MS = 4_000;

type Provider = "deepseek" | "deepinfra";

const ENDPOINTS: Record<Provider, string> = {
  deepseek: "https://api.deepseek.com/user/balance",
  // Not currently served: DeepInfra answers 404 here and publishes no GET equivalent
  // (see parseDeepinfraBalance for what was measured). Kept as specified so the badge
  // starts working the day they ship it, and the error text says so meanwhile.
  deepinfra: "https://api.deepinfra.com/v1/user/account",
};

/**
 * Turns any failure into a sentence an editor can act on.
 *
 * The distinction that matters: a 401 means the key is wrong, which they can fix,
 * while a 404 means this provider simply has no such endpoint, which they cannot.
 * Collapsing both into "не удалось" would send them to re-paste a key that is fine.
 */
function explain(status: number, provider: Provider): string {
  if (status === 401 || status === 403) return "Ключ отклонён провайдером.";
  if (status === 404) {
    return provider === "deepinfra"
      ? "DeepInfra не отдаёт остаток по API — смотрите баланс в личном кабинете."
      : "Провайдер не отдаёт остаток по этому адресу.";
  }
  if (status === 429) return "Провайдер отклонил запрос по частоте.";
  return `Провайдер ответил ${status}.`;
}

async function fetchBalance(provider: Provider, key: string): Promise<ProviderBalance> {
  try {
    const response = await fetch(ENDPOINTS[provider], {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      return { isSet: true, balance: null, error: explain(response.status, provider) };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const parsed =
      provider === "deepseek"
        ? parseDeepseekBalance(payload)
        : parseDeepinfraBalance(payload);

    if (!parsed) {
      return {
        isSet: true,
        balance: null,
        error: "Не удалось разобрать ответ провайдера.",
      };
    }

    return { isSet: true, balance: formatMoney(parsed.amount, parsed.currency), error: null };
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

    return {
      isSet: true,
      balance: null,
      error: timedOut ? "Провайдер не ответил за 4 секунды." : "Сеть недоступна.",
    };
  }
}

/**
 * Both providers are read even if one fails.
 *
 * A shared Promise.all would throw away the good result when the bad one rejects,
 * and a provider being down must not blank the other's balance. Each call already
 * turns its own failure into a value, so the pair cannot reject in the first place.
 */
export async function GET() {
  const [deepseekKey, deepinfraKey] = await Promise.all([
    getSetting("DEEPSEEK_API_KEY"),
    getSetting("DEEPINFRA_API_KEY"),
  ]);

  const [deepseek, deepinfra] = await Promise.all([
    deepseekKey ? fetchBalance("deepseek", deepseekKey) : Promise.resolve(notConfigured()),
    deepinfraKey ? fetchBalance("deepinfra", deepinfraKey) : Promise.resolve(notConfigured()),
  ]);

  return NextResponse.json(
    { deepseek, deepinfra },
    // Ten seconds in the browser: long enough to survive a slow page, short enough
    // that a refresh actually re-reads the balance.
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}