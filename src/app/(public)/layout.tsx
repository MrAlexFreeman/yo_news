import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { YandexMetrika } from "@/components/analytics/yandex-metrika";
import { getCategories } from "@/lib/public-queries";

/**
 * Chrome for every public route. Kept in a `(public)` group so the editorial
 * UI under /admin keeps its own full-bleed layout.
 *
 * The dateline is frozen at render time: with `revalidate = 300` a cached page
 * must not recompute "today" on every request.
 *
 * The analytics counter sits here rather than in the root layout for the same reason
 * the group exists: a counter measures readers, and an editorial visit is not a
 * reader. It also keeps session recording away from the admin's own forms.
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
      <YandexMetrika />
    </>
  );
}
