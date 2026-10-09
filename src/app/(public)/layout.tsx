import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { YandexMetrika } from "@/components/analytics/yandex-metrika";
import { getCategories, getTrendingTags } from "@/lib/public-queries";

/**
 * How many topics the strip carries.
 *
 * Six would be one more than the row holds on a phone, and a topic scrolled half out of
 * view is a topic the reader cannot read.
 */
const TRENDING_TAGS_COUNT = 5;

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
  // One round trip for both header shelves: the rubric pills and the topic strip beneath
  // them. Neither waits on the other, and `TrendingBar` renders nothing when the strip
  // comes back empty, so an install with no tags pays nothing and shows no bar.
  const [categories, trendingTags] = await Promise.all([
    getCategories(),
    getTrendingTags(TRENDING_TAGS_COUNT),
  ]);
  const now = new Date();

  return (
    <>
      <PublicHeader
        categories={categories}
        trendingTags={trendingTags}
        now={now}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <PublicFooter />
      <YandexMetrika />
    </>
  );
}
