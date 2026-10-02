import { redirect } from "next/navigation";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Админка",
};

/**
 * Entry point for the CMS.
 *
 * The public interface deliberately carries no link to /admin, so this bare path
 * is how an editor gets in — it has to work, not 404. It sits under the same
 * `/admin/:path*` matcher as the rest of the editorial area, so the redirect is
 * itself behind Basic Auth: an anonymous request never even reaches this file.
 */
export default function AdminIndexPage() {
  redirect("/admin/articles");
}