/**
 * Reading and formatting provider balances.
 *
 * Pure, and free of credentials, so the editorial test suite can assert on the
 * parsers against the payloads the providers actually return. The shapes below were
 * captured from live responses, not from documentation — see the note on each
 * parser for what came back.
 */

export type Balance = {
  amount: number;
  currency: string;
};

/**
 * Formats a balance for the badge in the admin UI.
 *
 * The currency placement differs by convention and the editors read these at a
 * glance: dollars carry a symbol in front, everything else trails the code. DeepSeek
 * bills in CNY, so "19.66 CNY" is what it actually prints, and "$4.85 USD" for
 * DeepInfra, which bills in dollars.
 *
 * Always two decimals: a balance that reads "19.6" next to one that reads "4.85"
 * looks like a rounding bug.
 */
export function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "";

  const fixed = Math.abs(amount).toFixed(2);
  const code = currency.trim().toUpperCase();

  if (code === "USD") return `$${fixed} USD`;
  if (!code) return fixed;
  return `${fixed} ${code}`;
}

/**
 * DeepSeek: `GET /user/balance`.
 *
 * Captured live:
 * `{"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"0.00",…},
 *   {"currency":"CNY","total_balance":"19.66",…}]}`
 *
 * Two things the shape forces. The balance is a *list* keyed by currency, not a
 * single amount, and the USD entry is zero while CNY holds the real credit. Printing
 * the first entry would show "$0.00 USD" on an account with money in it, so the first
 * entry with a non-zero total wins and the first entry is only the fallback.
 */
export function parseDeepseekBalance(payload: unknown): Balance | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { is_available?: unknown; balance_infos?: unknown };

  if (body.is_available === false) return null;
  if (!Array.isArray(body.balance_infos)) return null;

  const entries = body.balance_infos
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as { currency?: unknown; total_balance?: unknown };
      const amount = Number(item.total_balance);
      const currency = typeof item.currency === "string" ? item.currency.trim() : "";
      if (!Number.isFinite(amount) || !currency) return null;
      return { amount, currency };
    })
    .filter((entry): entry is Balance => entry !== null);

  if (entries.length === 0) return null;

  return entries.find((entry) => entry.amount !== 0) ?? entries[0]!;
}

/**
 * DeepInfra.
 *
 * There is currently no public GET endpoint for the remaining credit, which is why
 * the admin shows "provider does not expose the balance" rather than a number.
 * Measured against the live key: `/v1/user/account` and `/v1/user/credits` both
 * answer 404, `/payment/funds` answers 405 because it is POST-only, and
 * `/payment/usage` requires a `from`/`to` period and reports spend rather than what
 * is left. The endpoint from the newsroom's brief was probed first among ten
 * candidates and is not served.
 *
 * The parser is kept anyway: it costs nothing, it is covered by the suite, and the
 * moment DeepInfra publishes the endpoint the UI fills in without another change.
 * It reads the field names their docs use for account credit, tolerating a string or
 * a number because providers disagree about which.
 */
export function parseDeepinfraBalance(payload: unknown): Balance | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const fields = ["total_credits", "credits", "balance", "amount", "total"];
  for (const field of fields) {
    const value = body[field];
    const amount = typeof value === "object" && value !== null ? NaN : Number(value);
    if (!Number.isFinite(amount)) continue;

    const currencyField = body.currency ?? body.currency_code;
    const currency =
      typeof currencyField === "string" && currencyField.trim()
        ? currencyField.trim()
        : "USD";
    return { amount, currency };
  }

  return null;
}

/** The outcome one provider contributes to the response. */
export type ProviderBalance = {
  isSet: boolean;
  balance: string | null;
  error: string | null;
};

/** Reports a provider with no key configured, which is not an error. */
export function notConfigured(): ProviderBalance {
  return { isSet: false, balance: null, error: null };
}