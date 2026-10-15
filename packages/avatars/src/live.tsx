import { Blobatar } from "@blobatar/react";
import { type Gaze, type GazeTarget, gaze } from "blobatar/gaze";
import "blobatar/gaze.css";
import "blobatar/motion.css";
import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "./cn";

export interface LiveBlobatarProps {
  /** Stable seed: a workspace icon seed, a user id, or any stable string. */
  readonly seed: string;
  /** Rendered size in pixels. */
  readonly size: number;
  /** Accessible name. When omitted the creature is decorative. */
  readonly title?: string;
  /**
   * Where the eyes should look while this is supplied — the address or email
   * field currently focused, for instance, or `"rest"` for a field whose
   * contents the creature should pointedly not read. Omitted or `null` lets it
   * glance around on its own.
   */
  readonly watch?: Element | "rest" | null;
  /** How far the eyes travel when looking, in viewBox units (roughly a fifth). */
  readonly travel?: number;
  readonly className?: string;
}

/** The eye excursion is a length, so it is only honoured once it is registered. */
function trackStyle(travel: number): CSSProperties {
  return { "--mo-track-travel": `${travel}px` } as CSSProperties;
}

/**
 * Whether the gaze driver can run at all, so a test or a very old browser gets
 * a static creature instead of an exception.
 */
function canTrack(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (typeof ResizeObserver === "undefined") {
    return false;
  }
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  return media?.matches !== true;
}

/**
 * The living blobatar: the same deterministic creature as {@link Avatar}, but
 * animated (breathe, bob, blink, idle glance) with the eyes able to follow an
 * element. Animation requires inline SVG plus Blobatar's stylesheets, so this is
 * a separate entry point from the static `<img>` path — a list of hundreds of
 * avatars should not pay for it.
 *
 * Motion is CSS the library ships: it stops entirely under
 * `prefers-reduced-motion`, and the gaze driver is never attached there.
 */
export function LiveBlobatar(props: LiveBlobatarProps) {
  const { seed, size, title, watch, travel = 5, className } = props;
  const host = useRef<HTMLSpanElement | null>(null);
  const driver = useRef<Gaze | null>(null);

  useEffect(() => {
    const svg = host.current?.querySelector("svg");
    if (!(svg instanceof SVGSVGElement) || !canTrack()) {
      return;
    }
    try {
      driver.current = gaze(svg, { target: null });
    } catch {
      driver.current = null;
    }
    return () => {
      driver.current?.stop();
      driver.current = null;
    };
  }, []);

  useEffect(() => {
    const target: GazeTarget = watch ?? null;
    driver.current?.lookAt(target);
  }, [watch]);

  return (
    <span ref={host} className={cn("inline-flex shrink-0", className)} style={trackStyle(travel)}>
      <Blobatar
        name={seed}
        size={size}
        animate="always"
        {...(title !== undefined ? { title } : {})}
      />
    </span>
  );
}
