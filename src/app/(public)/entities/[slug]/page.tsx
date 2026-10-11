import { permanentRedirect } from "next/navigation";

import { ENTITY_URL_PREFIX } from "@/lib/entity-card";

/**
 * The address entity cards used to live at.
 *
 * Renaming a route inside a site whose articles link it is not the same as renaming a URL:
 * `/entities/<slug>` is written into the stored body of every story published before the
 * rename, and those bodies are not rewritten — silently editing published prose to keep a
 * route tidy is the wrong trade. So the old address keeps answering, permanently, and a
 * crawler that indexed it follows to the new one instead of collecting a 404.
 *
 * A permanent redirect rather than a temporary one on purpose: the move is not provisional,
 * and the ranking of the old address should transfer rather than be duplicated.
 *
 * Nothing else lives here. The page, its metadata and its "Материалы по теме" block are at
 * `/wiki/<slug>`, and a second copy of them at this address would be the duplicate-content
 * problem this redirect exists to avoid.
 */
export default async function LegacyEntityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`${ENTITY_URL_PREFIX}${encodeURIComponent(slug)}`);
}
