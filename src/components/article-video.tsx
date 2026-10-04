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
    // No <figure> here: `buildVideoEmbed` already emits one, and nesting a second
    // would put the caption-less wrapper inside another.
    <div
      className="mt-6 aspect-video w-full overflow-hidden rounded-sm bg-ink [&>figure]:h-full [&>iframe]:h-full [&>iframe]:w-full"
      dangerouslySetInnerHTML={{ __html: embed }}
    />
  );
}