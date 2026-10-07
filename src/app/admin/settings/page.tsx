import type { Metadata } from "next";

import { SettingsForm } from "@/app/admin/settings/components/settings-form";
import {
  SyndicationSettings,
  type SyndicationState,
} from "@/app/admin/settings/components/syndication-settings";
import { DEFAULT_SYNDICATION_ENABLED, parseEnabled } from "@/lib/settings-keys";
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

  /*
    Masks only — the raw keys never reach this component's props.

    `vkAccessToken` was missing from this list until now, so the VK field rendered
    "не задан" even with a working token stored, and `deepinfraApiKey` was filled from
    DEEPSEEK_API_KEY — each provider's field was showing the other's state. Both are
    the same underlying mistake: the view is built by hand, and a field can be missed.
  */
  const initial = {
    deepseekApiKey: toView(resolved.DEEPSEEK_API_KEY),
    deepinfraApiKey: toView(resolved.DEEPINFRA_API_KEY),
    vkAccessToken: toView(resolved.VK_ACCESS_TOKEN),
  };

  /*
    The two destinations are not secrets: a channel's @name is printed in its own
    public header, and an id is in every message link. They are passed through as
    plain text so the form can show what is currently configured, which is the
    difference between an editor confirming the right channel and guessing.
  */
  const syndication: SyndicationState = {
    telegram: {
      token: toView(resolved.TELEGRAM_BOT_TOKEN),
      destination: resolved.TELEGRAM_CHANNEL_ID.value,
      enabled: parseEnabled(
        resolved.TELEGRAM_ENABLED.value,
        DEFAULT_SYNDICATION_ENABLED.telegram,
      ),
    },
    max: {
      token: toView(resolved.MAX_BOT_TOKEN),
      destination: resolved.MAX_CHAT_ID.value,
      enabled: parseEnabled(resolved.MAX_ENABLED.value, DEFAULT_SYNDICATION_ENABLED.max),
    },
  };

  return (
    <div className="flex-1 bg-neutral-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="border border-neutral-300 bg-white px-5 py-4">
          <h1 className="text-base font-semibold text-neutral-900">Настройки</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Ключи внешних сервисов и каналы автопостинга, которые использует редакция.
          </p>
        </header>

        <SettingsForm initial={initial} />
        <SyndicationSettings initial={syndication} />
      </div>
    </div>
  );
}