import { type AvatarBlob, type AvatarTheme, avatarField } from "@aulora/avatars";
import { cn } from "@aulora/ui-web";
import { type CSSProperties, useMemo } from "react";

export interface BlobBackdropProps {
  /** Seed for the drifting blob field: the workspace icon seed, or any stable id. */
  readonly seed: string;
  readonly className?: string;
  /** Settles the outer edges toward the page colour. On by default. */
  readonly vignette?: boolean;
}

/**
 * Turbulence, as a 180px tile. Banding is the failure mode of a large, soft
 * gradient, and a couple of percent of noise removes it without being visible
 * as texture on its own.
 */
const GRAIN_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">' +
    '<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/></filter>' +
    '<rect width="180" height="180" filter="url(#g)" opacity="0.5"/></svg>',
)}")`;

const DRIFT_CLASSES = ["auth-blob-a", "auth-blob-b", "auth-blob-c", "auth-blob-a"] as const;

/** Position, size and falloff for one blob, in viewport-relative units. */
function blobStyle(blob: AvatarBlob, index: number): CSSProperties {
  const size = `${(blob.r * 100).toFixed(1)}vmin`;
  return {
    left: `calc(${(blob.cx * 100).toFixed(2)}% - ${size} / 2)`,
    top: `calc(${(blob.cy * 100).toFixed(2)}% - ${size} / 2)`,
    width: size,
    height: size,
    opacity: blob.opacity,
    backgroundImage:
      `radial-gradient(closest-side, ${blob.color} 0%, ${blob.color} 46%, ` +
      `color-mix(in srgb, ${blob.color} 55%, transparent) 72%, transparent 100%)`,
    animationDelay: `${(index * -7).toFixed(0)}s`,
  };
}

/**
 * One appearance's worth of the field. `isolate` keeps the blend inside this
 * layer so it can never tint the page chrome, and the blend itself is the whole
 * trick: `screen` adds light on a dark host, `multiply` subtracts it on a light
 * one, so the same palette stays luminous either way instead of washing out.
 */
function FieldLayer({
  seed,
  theme,
  className,
}: Pick<BlobBackdropProps, "seed" | "className"> & { readonly theme: AvatarTheme }) {
  const field = useMemo(() => avatarField(seed, theme), [seed, theme]);
  return (
    <div
      className={cn(
        "absolute inset-0 isolate",
        theme === "dark" ? "mix-blend-screen" : "mix-blend-multiply",
        className,
      )}
      style={{ opacity: field.opacity }}
    >
      {field.blobs.map((blob, index) => (
        <div
          key={`${blob.color}-${index.toFixed(0)}`}
          className={cn("auth-blob", DRIFT_CLASSES[index] ?? "auth-blob-a")}
          style={blobStyle(blob, index)}
        />
      ))}
    </div>
  );
}

/**
 * The Aulora signature backdrop: three or four saturated blobs drawn from the
 * workspace's own blobatar palette, drifting slowly behind a screen, with a
 * whisper of grain over the top. Because the palette comes from the seed, no
 * two workspaces look alike and every screen belonging to one workspace looks
 * like itself. Purely decorative and hidden from assistive technology; the
 * drift collapses under `prefers-reduced-motion` via the global rule.
 */
export function BlobBackdrop({ seed, className, vignette = true }: BlobBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <FieldLayer seed={seed} theme="light" className="dark:hidden" />
      <FieldLayer seed={seed} theme="dark" className="hidden dark:block" />
      <div className="auth-grain" style={{ backgroundImage: GRAIN_IMAGE }} />
      {/*
        Vignette. Deliberately weak and pushed to the outer 25%: it exists to
        settle the very edges, not to veil the colour — a full-strength vignette
        is what turned this field grey the first time round.
      */}
      {vignette && (
        <div className="absolute inset-0 bg-[radial-gradient(125%_105%_at_50%_42%,transparent_62%,var(--aulora-bg)_100%)] opacity-55" />
      )}
    </div>
  );
}
