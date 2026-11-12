import { ThinkingOrb } from "thinking-orbs";

/**
 * The animated orb itself. Kept in its own module so `thinking-orbs` (a canvas
 * renderer) is a lazy chunk that only calls and transcripts ever download.
 */
export default function TranscriptionOrbCanvas({
  size,
  theme,
  paused,
}: {
  readonly size: 20 | 32;
  readonly theme: "dark" | "light";
  readonly paused: boolean;
}) {
  return (
    <ThinkingOrb
      state="listening"
      size={size}
      theme={theme}
      paused={paused}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
