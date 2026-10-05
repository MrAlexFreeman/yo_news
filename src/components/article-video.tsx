import { buildVideoEmbed } from "@/lib/video-embed";

/**
 * Responsive 16:9 player for the story's main video.
 *
 * `buildVideoEmbed` already refuses anything that is not a YouTube, Rutube or VK
 * Video URL, so an unrecognised link renders nothing rather than an iframe
 * pointing wherever the editor typed.
 */
export function ArticleVideo({ url }: { url: string }) {
  const embed = buildVideoEmbed(url);
  if (!embed) return null;

  return (
    /*
      No <figure> here: buildVideoEmbed already emits one, and a second wrapper
      would nest a caption-less figure inside another.

      The selectors are descendant (`[&_figure]`, `[&_iframe]`) rather than child
      ones. A child selector only matches the <figure>, and the iframe sits inside
      it, so it kept its default 300x150 and the player rendered as a small window
      in the corner of a large black rectangle — exactly the desktop complaint.
      Forcing both the figure and the iframe to the full 16:9 box makes the player
      fill the content column at every width.
    */
    <div
      data-testid="article-video"
      className="mt-6 aspect-video w-full overflow-hidden rounded-sm bg-black [&_figure]:flex [&_figure]:h-full [&_figure]:w-full [&_figure]:items-center [&_figure]:justify-center [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0"
      dangerouslySetInnerHTML={{ __html: embed }}
    />
  );
}