import { Blobatar } from "@blobatar/react";
import type { CSSProperties } from "react";
import { cn } from "./cn";

export interface AvatarProps {
  /**
   * Stable seed: use a user id (`userAvatarSeed`) or a server icon seed from
   * the well-known document. Never the display name.
   */
  seed: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Role color; when set, draws a 2px ring around the avatar. */
  roleColor?: string;
  /** Blobatar animation mode. Omit for a static `<img>` avatar. */
  animate?: "hover" | "always";
  /** Optional accessible label. When omitted the avatar is decorative. */
  title?: string;
  className?: string;
}

/**
 * The Aulora avatar: a Blobatar seeded by a stable id, with an optional 2px
 * role-color ring. Presentational and dependency-light; animation is opt-in
 * because it switches Blobatar from an `<img>` to inline SVG.
 */
export function Avatar({ seed, size = 32, roleColor, animate, title, className }: AvatarProps) {
  const content =
    animate === undefined ? (
      <Blobatar name={seed} size={size} {...(title !== undefined ? { title } : {})} />
    ) : (
      <Blobatar
        name={seed}
        size={size}
        animate={animate}
        {...(title !== undefined ? { title } : {})}
      />
    );

  const style: CSSProperties = { width: size, height: size };
  if (roleColor !== undefined) {
    style.boxShadow = `0 0 0 2px ${roleColor}`;
  }

  return (
    <span
      className={cn("inline-flex shrink-0 overflow-hidden rounded-pill bg-surface-3", className)}
      style={style}
    >
      {content}
    </span>
  );
}
