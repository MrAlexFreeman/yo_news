"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Cover image that degrades instead of showing a broken-image icon.
 *
 * `Article.coverImage` is a free-text URL an editor types or picks from the
 * upload endpoint, and it lives outside the database on disk. Plenty of things
 * can therefore leave a row pointing at something that no longer resolves: a
 * host that started refusing the request, a file removed from UPLOAD_DIR, a
 * typo in a pasted link. A server render cannot know that — the row is not empty,
 * so the markup looks correct and only the browser discovers the failure.
 *
 * This is a client component for one reason: the failure is only observable after
 * the response arrives, which is exactly what onError reports. It swaps in the
 * bundled fallback once. If the fallback itself is missing, the last state drops
 * the <img> and the caller's own empty slot shows through, so the worst case is a
 * blank frame rather than a torn icon.
 */

const FALLBACK_SRC = "/placeholder.png";

export type CoverImageProps = {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  /** Set only on the single above-the-fold cover that is the LCP candidate. */
  preload?: boolean;
  /** Mutually exclusive with `fill`; supply both dimensions for a sized image. */
  width?: number;
  height?: number;
};

export function CoverImage({
  src,
  alt,
  className,
  sizes,
  preload = false,
  width,
  height,
}: CoverImageProps) {
  const [stage, setStage] = useState<"original" | "fallback" | "gone">("original");

  if (stage === "gone") return null;

  const source = stage === "original" ? src : FALLBACK_SRC;

  return (
    <Image
      // Remounting on the source swap stops the browser from serving the failed
      // response out of its own cache for the new URL.
      key={source}
      src={source}
      alt={alt}
      fill={width === undefined}
      width={width}
      height={height}
      sizes={sizes}
      preload={preload}
      onError={() => setStage((current) => (current === "original" ? "fallback" : "gone"))}
      className={cn("object-cover", className)}
    />
  );
}