import { avatarHead } from "@aulora/avatars";
import { LiveBlobatar } from "@aulora/avatars/live";
import { cn } from "@aulora/ui-web";
import { useEffect, useState } from "react";

/** The hero tile is this many times the creature, leaving room for its glow. */
const GLOW = 1.5;
/** Below this width the hero steps down, so a phone keeps its content on screen. */
const COMPACT_QUERY = "(max-width: 640px)";
const COMPACT_SCALE = 0.68;

/** Whether the viewport is a phone width, tracked so the hero can step down. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.(COMPACT_QUERY).matches ?? false),
  );
  useEffect(() => {
    const media = window.matchMedia?.(COMPACT_QUERY);
    if (media === undefined) {
      return;
    }
    const onChange = () => {
      setCompact(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);
  return compact;
}

export interface BlobatarHeroProps {
  /** Seed for the creature: a workspace icon seed, or a host-derived placeholder. */
  readonly seed: string;
  /** Creature size in pixels at full width. The tile is 1.5x this. */
  readonly size?: number;
  /** Accessible name for the creature. */
  readonly title?: string;
  /** Where the eyes look: a focused field, `"rest"`, or nothing. */
  readonly watch?: Element | "rest" | null;
  /** Uploaded workspace logo; replaces the generated creature when set. */
  readonly src?: string | null;
  readonly className?: string;
}

/**
 * The one hero element of a pre-session screen: the workspace's own blobatar,
 * oversized, alive, and floating on a glow drawn from its own colour. It is
 * deliberately the loudest thing on the page — everything else is quiet type,
 * one field and one button.
 *
 * Changing the seed swaps the creature with a short cross-fade, which is what
 * makes typing a hostname feel like it is conjuring the workspace rather than
 * filling in a form.
 */
export function BlobatarHero(props: BlobatarHeroProps) {
  const { seed, size = 140, title, watch, src, className } = props;
  const compact = useCompact();
  const px = compact ? Math.round(size * COMPACT_SCALE) : size;
  const plate = { width: px * GLOW, height: px * GLOW };
  const light = avatarHead(seed, "light");
  const dark = avatarHead(seed, "dark");

  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={plate}>
      <div
        aria-hidden="true"
        className="auth-hero-glow dark:hidden"
        style={{
          ...plate,
          background: `radial-gradient(circle, ${light} 0%, transparent 62%)`,
          opacity: 0.3,
        }}
      />
      <div
        aria-hidden="true"
        className="auth-hero-glow hidden dark:block"
        style={{
          ...plate,
          background: `radial-gradient(circle, ${dark} 0%, transparent 62%)`,
          opacity: 0.5,
        }}
      />
      {/*
        A soft scrim directly behind the creature. Without it a blue workspace
        on a blue field is a blue smudge; a couple of percent of the page colour
        buys the object its silhouette and makes the glow read as a halo.
      */}
      <div
        aria-hidden="true"
        className="auth-hero-glow"
        style={{
          ...plate,
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--aulora-bg) 68%, transparent) 0%, transparent 58%)",
        }}
      />
      <div key={seed} className="auth-hero-float relative animate-pop-in">
        {src !== undefined && src !== null && src.length > 0 ? (
          <img
            src={src}
            alt={title ?? ""}
            width={px}
            height={px}
            draggable={false}
            className="rounded-[26%] object-cover shadow-[0_22px_44px_-20px_rgba(0,0,0,0.55)]"
            style={{ width: px, height: px }}
          />
        ) : (
          <LiveBlobatar
            seed={seed}
            size={px}
            {...(title !== undefined ? { title } : {})}
            {...(watch !== undefined ? { watch } : {})}
            className="drop-shadow-[0_20px_32px_rgba(0,0,0,0.32)]"
          />
        )}
      </div>
    </div>
  );
}
