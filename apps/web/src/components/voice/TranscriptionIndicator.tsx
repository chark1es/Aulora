import { cn, usePrefersReducedMotion } from "@aulora/ui-web";
import { lazy, Suspense, useSyncExternalStore } from "react";

const OrbCanvas = lazy(() => import("./TranscriptionOrbCanvas"));

function subscribeTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
  };
}

function themeSnapshot(): "dark" | "light" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

/** The app’s resolved theme, kept in step with the `dark` class on `<html>`. */
function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, () => "dark");
}

export const TRANSCRIPTION_LABEL = "Transcription is on";

export interface TranscriptionIndicatorProps {
  readonly size?: 20 | 32;
  /** Extra hint text for the tooltip (for example "Your audio is not included"). */
  readonly detail?: string;
  readonly className?: string;
}

/**
 * The symbol that shows a transcription is in progress: a small animated orb.
 *
 * The box is a fixed square from first paint, so it never shifts the layout
 * when the chunk loads. The label is on the wrapper (`role="img"`) and as the
 * native tooltip; the canvas is decorative. With reduced motion the orb is
 * frozen rather than removed, so the state is still visible.
 */
export function TranscriptionIndicator({
  size = 20,
  detail,
  className,
}: TranscriptionIndicatorProps) {
  const theme = useResolvedTheme();
  const reducedMotion = usePrefersReducedMotion();
  const label = detail === undefined ? TRANSCRIPTION_LABEL : `${TRANSCRIPTION_LABEL}. ${detail}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="transcription-indicator"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <Suspense
        fallback={
          <span
            aria-hidden="true"
            className="block rounded-full bg-accent/60"
            style={{ width: size * 0.4, height: size * 0.4 }}
          />
        }
      >
        <OrbCanvas size={size} theme={theme} paused={reducedMotion} />
      </Suspense>
    </span>
  );
}

/** A compact pill for headers: the orb and the word "Transcribing". */
export function TranscriptionBadge({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface-3 pl-1 pr-2.5 text-[11px] font-medium text-text",
        className,
      )}
    >
      <TranscriptionIndicator />
      <span>Transcribing</span>
    </span>
  );
}
