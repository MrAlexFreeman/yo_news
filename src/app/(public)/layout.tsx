import { HeaderShell } from "@/components/header-shell";
import { MascotWidget } from "@/components/mascot-widget";
import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { YandexMetrika } from "@/components/analytics/yandex-metrika";
import { getLiveStreamView } from "@/lib/live-stream-server";
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
  // them, plus the live badge. Neither waits on the other, and `TrendingBar` renders nothing
  // when the strip comes back empty, so an install with no tags pays nothing and shows no bar.
  const [categories, trendingTags, live] = await Promise.all([
    getCategories(),
    getTrendingTags(TRENDING_TAGS_COUNT),
    getLiveStreamView(),
  ]);
  const now = new Date();

  return (
    <>
      {/*
        `HeaderShell` is the two-phase header. It wraps the server-rendered masthead as
        `children` rather than rendering it, so the masthead is still prerendered and the
        shell only owns what has to be client-side: the scroll threshold and the slim bar
        that replaces the masthead once the reader is 120px down.
      */}
      <HeaderShell categories={categories} live={live}>
        <PublicHeader
          categories={categories}
          trendingTags={trendingTags}
          live={live}
          now={now}
        />
      </HeaderShell>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <PublicFooter />

      {/*
        The mascot, inside the public group rather than the root layout. The root layout
        also wraps `/admin`, and a cat that turns to follow the cursor is a moving target
        for someone trying to edit a headline. The CMS gets a working surface.

        After the footer so it paints over the page corner rather than being painted over
        by the footer's own stacking.
      */}
      <MascotWidget />

      <YandexMetrika />
    </>
  );
}
