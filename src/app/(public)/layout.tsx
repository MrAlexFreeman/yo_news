import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { getCategories } from "@/lib/public-queries";

/**
 * Chrome for every public route. Kept in a `(public)` group so the editorial
 * UI under /admin keeps its own full-bleed layout.
 *
 * The dateline is frozen at render time: with `revalidate = 300` a cached page
 * must not recompute "today" on every request.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const categories = await getCategories();
  const now = new Date();

  return (
    <>
      <PublicHeader categories={categories} now={now} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
