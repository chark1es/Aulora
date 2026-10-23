import { Blobatar } from "@blobatar/react";
import type { CSSProperties } from "react";
import { cn } from "./cn";
import { type AvatarShape, avatarRadius } from "./shape";

export interface AvatarProps {
  /**
   * Stable seed: use a user id (`userAvatarSeed`) or a server icon seed from
   * the well-known document. Never the display name.
   */
  seed: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Blobatar animation mode. Omit for a static `<img>` avatar. */
  animate?: "hover" | "always";
  /** Optional accessible label. When omitted the avatar is decorative. */
  title?: string;
  /**
   * Workspace profile picture. When set, it replaces the generated avatar.
   * Each workspace stores its own, so the same account can look different.
   */
  src?: string;
  /** `circle` for people, `squircle` for servers and workspaces. */
  shape?: AvatarShape;
  className?: string;
}

/**
 * The Aulora avatar: a Blobatar seeded by a stable id. Presentational and
 * dependency-light; animation is opt-in because it switches Blobatar from an
 * `<img>` to inline SVG.
 */
export function Avatar(props: AvatarProps) {
  const { seed, size = 32, animate, title, src, shape = "circle", className } = props;
  const photo = src !== undefined && src.length > 0;
  const content = photo ? (
    <img
      src={src}
      alt={title ?? ""}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size, objectFit: "cover" }}
    />
  ) : animate === undefined ? (
    <Blobatar name={seed} size={size} {...(title !== undefined ? { title } : {})} />
  ) : (
    <Blobatar
      name={seed}
      size={size}
      animate={animate}
      {...(title !== undefined ? { title } : {})}
    />
  );

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: avatarRadius(size, shape),
  };

  return (
    <span
      className={cn("inline-flex shrink-0 overflow-hidden bg-surface-3", className)}
      style={style}
    >
      {content}
    </span>
  );
}
