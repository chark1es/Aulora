import { palette, traits } from "blobatar";

/**
 * Atmosphere derived from an avatar seed.
 *
 * Every blobatar is built from a single hue (see `blobatar`'s colour module),
 * which is what makes a generated field of them feel like one family. These
 * helpers expose that hue and a small tetrad around it, so a screen can borrow
 * a workspace's own colours for its background instead of painting a generic
 * grey wash. Nothing here touches the avatar geometry: the same seed renders
 * the same creature and the same field on every client.
 */

/** One soft blob in the backdrop field, positioned in fractions of the frame. */
export interface AvatarBlob {
  /** `#rrggbb` fill for the blob. */
  readonly color: string;
  /** Centre, `0` to `1` across the frame. */
  readonly cx: number;
  /** Centre, `0` to `1` down the frame. A blob may sit just outside. */
  readonly cy: number;
  /** Diameter as a fraction of the frame's shorter side. */
  readonly r: number;
  /** Layer opacity, `0` to `1`. */
  readonly opacity: number;
}

/** The colours a seed contributes to a screen. */
export interface AvatarField {
  /** The seed's hue in degrees, `0` to `360`. */
  readonly hue: number;
  /** The seed's own body colour, for a hero glow or a focus ring. */
  readonly head: string;
  /** The seed's eye colour, for a hairline highlight. */
  readonly eye: string;
  /** Three or four soft blobs to layer behind the content. */
  readonly blobs: readonly AvatarBlob[];
  /** Opacity for the field as a whole, tuned to the appearance. */
  readonly opacity: number;
}

/** Which appearance the field is tuned for. Blending differs between the two. */
export type AvatarTheme = "light" | "dark";

interface BlobSlot {
  /** Hue offset from the seed's own hue, in degrees. */
  readonly dh: number;
  /** Blobatar swatch position: pale at `0`, ink at `0.999`. */
  readonly tone: number;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly opacity: number;
}

/**
 * Four blobs, and the geometry is the whole trick: each one is large enough
 * that its *bright core* sits on or just past an edge, so what a viewer sees is
 * a saturated plateau falling off toward the middle — not the pale tail of a
 * small blob. A field of "soft circles" placed inside the frame reads as grey
 * smudges no matter how good the palette is.
 *
 * Hues are a tetrad off the seed's own hue, so two workspaces feel related but
 * are never the same picture.
 */
const FIELD_SLOTS: readonly BlobSlot[] = [
  { dh: 0, tone: 0.93, cx: 0.04, cy: -0.02, r: 1.0, opacity: 1 },
  { dh: 40, tone: 0.8, cx: 1.0, cy: 0.16, r: 0.78, opacity: 0.9 },
  { dh: -52, tone: 0.62, cx: 0.06, cy: 1.02, r: 0.86, opacity: 0.9 },
  { dh: 104, tone: 0.93, cx: 1.02, cy: 0.96, r: 0.7, opacity: 0.8 },
];

/**
 * The tone each blob takes in each appearance, and how strongly the layer is
 * composited.
 *
 * Dark hosts are lit by *adding* light, so the field stays on the bright and
 * pastel swatches or the page turns to mud. A light host is lit by
 * *subtracting* it, so the field moves to the deep and mid swatches, where a
 * multiply blend reads as a stained-paper tint rather than a grey smudge.
 */
const DARK_TONES: readonly number[] = [0.93, 0.8, 0.62, 0.93];
const LIGHT_TONES: readonly number[] = [0.8, 0.62, 0.8, 0.62];

function tonesFor(theme: AvatarTheme): readonly number[] {
  return theme === "light" ? LIGHT_TONES : DARK_TONES;
}

/** Layer opacity per appearance. Vivid, but never so loud the copy fights it. */
function layerOpacity(theme: AvatarTheme): number {
  return theme === "light" ? 0.5 : 0.68;
}

const FALLBACK = "#E4571C";

/** The hue a seed hashes to, in degrees. */
export function avatarHue(seed: string): number {
  return traits(seed).num("hue", 0, 360);
}

function swatch(hue: number, tone: number): string {
  return palette(hue, false, tone).head ?? FALLBACK;
}

/** The avatar's own body colour, for a glow or a ring around its hero. */
export function avatarHead(seed: string, theme: AvatarTheme = "dark"): string {
  return swatch(avatarHue(seed), tonesFor(theme).at(0) ?? 0.93);
}

/** The seed's tetrad as a positioned, theme-tuned blob field. */
export function avatarField(seed: string, theme: AvatarTheme = "dark"): AvatarField {
  const hue = avatarHue(seed);
  const tones = tonesFor(theme);
  const blobs = FIELD_SLOTS.map((slot, index) => ({
    color: swatch(hue + slot.dh, tones.at(index) ?? slot.tone),
    cx: slot.cx,
    cy: slot.cy,
    r: slot.r,
    opacity: slot.opacity,
  }));
  return {
    hue,
    head: swatch(hue, tones.at(0) ?? 0.93),
    eye: swatch(hue, 0.999),
    blobs,
    opacity: layerOpacity(theme),
  };
}
