import type { Metadata } from "next";

import { SettingsForm } from "@/app/admin/settings/components/settings-form";
import { resolveAllSettings, toView } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Настройки — Админка",
};

/**
 * Must reflect the database immediately: the whole point is that a key saved
 * here starts being used without a redeploy, so a prerendered page would defeat
 * it by showing the previous state.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const resolved = await resolveAllSettings();

  // Masks only — the raw keys never reach this component's props.
  const initial = {
    deepseekApiKey: toView(resolved.DEEPSEEK_API_KEY),
    deepinfraApiKey: toView(resolved.DEEPINFRA_API_KEY),
  };

  return (
    <div className="flex-1 bg-neutral-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="border border-neutral-300 bg-white px-5 py-4">
          <h1 className="text-base font-semibold text-neutral-900">Настройки</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Ключи внешних сервисов, которые использует редакция.
          </p>
        </header>

        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}