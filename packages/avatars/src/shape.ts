export type AvatarShape = "circle" | "squircle";

/** Corner radius for an avatar: a full circle, or a soft squircle for servers. */
export function avatarRadius(size: number, shape: AvatarShape = "circle"): number {
  return shape === "squircle" ? Math.round(size * 0.3) : size / 2;
}
