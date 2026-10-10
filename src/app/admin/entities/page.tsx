import type { Metadata } from "next";

import { EntityCardsScreen } from "@/app/admin/entities/components/entity-cards-screen";

export const metadata: Metadata = {
  title: "Карточки объектов",
  robots: { index: false, follow: false },
};

/**
 * `/admin/entities` — the reference desk.
 *
 * The page is a thin shell: the list, the search and the form are one client component,
 * because search-as-you-type over a small table is an interaction, not a navigation. The
 * authentication is the layout's — this route group sits under `/admin/:path*`, which
 * `src/proxy.ts` guards with Basic Auth — so there is no check here to forget to add.
 */
export default function EntitiesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <EntityCardsScreen />
    </div>
  );
}