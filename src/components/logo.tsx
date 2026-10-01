import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg";

type LogoProps = {
  /** `lg` for the masthead, `md` for the footer, `sm` for tight spots. */
  size?: LogoSize;
  className?: string;
};

const SIZES: Record<LogoSize, { letter: string; word: string }> = {
  lg: { letter: "text-4xl", word: "text-2xl" },
  md: { letter: "text-3xl", word: "text-xl" },
  sm: { letter: "text-xl", word: "text-sm" },
};

/**
 * The «Ё-новости» wordmark.
 *
 * The brand idea is the diaeresis, so it gets the accent colour: `.logo-yo`
 * paints the top of the Ё amber and the rest orange via a gradient clipped to
 * the glyph. Drawing the dots as separate elements instead would mean
 * positioning them against font metrics, which drifts between Lora and its
 * fallbacks — and it would leave the visible text as "Е", breaking the rule that
 * a link's visible label must appear in its accessible name.
 *
 * The letter is a real text node, so selection, search and assistive tech all
 * read «Ё-новости» verbatim.
 */
export function Logo({ size = "lg", className }: LogoProps) {
  const scale = SIZES[size];

  return (
    <span
      className={cn(
        "inline-flex items-baseline leading-none select-none",
        className,
      )}
    >
      <span
        className={cn(
          "logo-yo font-[family-name:var(--font-lora)] font-bold",
          scale.letter,
        )}
      >
        Ё
      </span>
      <span
        className={cn(
          "font-semibold tracking-[-0.03em] text-ink",
          scale.word,
        )}
      >
        -новости
      </span>
    </span>
  );
}
