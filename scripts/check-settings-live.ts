/**
 * Live proof that a key saved in /admin/settings reaches the cover generator on
 * the next request, with no pm2 restart.
 *
 * Kept out of `npm run check`: it sleeps past the endpoint's rate-limit window
 * and needs outbound access to DeepInfra. Run it by hand after changing how keys
 * are resolved. It stores a deliberately fake key, so no money is spent — the
 * provider answers 401 and that is the evidence.
 *
 * DESTRUCTIVE, and refuses to run unless told otherwise. Storing the fake key
 * overwrites the real DEEPINFRA_API_KEY and the cleanup at the end clears it, so
 * running this against production deletes the newsroom's key for good: the script
 * has no way to put the old value back, because keys are write-only by design.
 *
 * Run with: ALLOW_SETTINGS_WRITE=1 npm run settings:check
 */
const BASE = process.env.CHECK_BASE_URL?.trim() || "http://localhost:3000";

if (process.env.ALLOW_SETTINGS_WRITE !== "1") {
  console.log(
    "Пропущен: набор затирает реальный DEEPINFRA_API_KEY.\n" +
      "Запускать только на одноразовой базе: ALLOW_SETTINGS_WRITE=1 npm run settings:check",
  );
  process.exit(0);
}

/** Past the endpoint's 5 s per-process window. */
const COOLDOWN_MS = 6000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shapes the two endpoints return, so the assertions below stay typed. */
type SettingsPayload = {
  error?: string;
  saved?: string[];
  settings?: Record<string, { isSet: boolean; masked: string; source: string }>;
};

async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Basic ${Buffer.from(
        `${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`,
      ).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as SettingsPayload };
}

async function main() {
  // A syntactically valid but non-existent key. DeepInfra answers 401 for it.
  const fake = `sk-deepinfra-fake-${Date.now()}`;

  console.log("1. Ключа нет ни в базе, ни в .env");
  await sleep(COOLDOWN_MS);
  // `title` is what validation requires; `mode` and `prompt` were removed when the
  // hint became an optional refinement named customPrompt.
  const before = await post("/api/admin/generate-cover", {
    title: "проверка сквозного чтения ключа",
    customPrompt: "крупный план",
  });
  console.log(
    `   ${before.status} — ${before.body.error?.slice(0, 80) ?? "?"}\n   ожидается 503 «Не задан»\n`,
  );

  console.log("2. Сохраняем поддельный ключ через /api/admin/settings");
  const saved = await post("/api/admin/settings", { deepinfraApiKey: fake });
  console.log(`   ${saved.status} saved=${JSON.stringify(saved.body.saved)}`);
  console.log(`   маска: ${saved.body.settings?.deepinfraApiKey?.masked}`);
  console.log(`   source: ${saved.body.settings?.deepinfraApiKey?.source}\n`);

  console.log("3. Сразу же генерируем — перезапуска нет, .env не менялся");
  await sleep(COOLDOWN_MS);
  const after = await post("/api/admin/generate-cover", {
    title: "проверка сквозного чтения ключа",
    customPrompt: "крупный план",
  });
  console.log(`   ${after.status} — ${after.body.error?.slice(0, 110) ?? "?"}`);

  const missingKey = (after.body.error ?? "").includes("Не задан");
  const providerSawKey =
    after.body.error?.includes("DeepInfra") && !missingKey;
  console.log(
    `   ${missingKey ? "FAIL" : "OK  "} ключ прочитан из базы, провайдер его получил\n`,
  );
  console.log(`   ${providerSawKey ? "OK  " : "FAIL"} ответ пришёл от провайдера, а не «не задан»`);

  console.log("\n4. Убираем ключ за собой");
  const cleared = await post("/api/admin/settings", { deepinfraApiKey: "" });
  console.log(
    `   ${cleared.status} source=${cleared.body.settings?.deepinfraApiKey?.source} (ожидается unset или environment)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});