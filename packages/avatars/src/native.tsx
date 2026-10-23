import { darkPalette, lightPalette } from "@aulora/tokens";
import { memo, useMemo } from "react";
import {
  Image,
  type StyleProp,
  StyleSheet,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { type AvatarShape, avatarRadius } from "./shape";
import { avatarSvg } from "./svg";

export {
  type AvatarBlob,
  type AvatarField,
  type AvatarTheme,
  avatarField,
  avatarHead,
  avatarHue,
} from "./field";
export {
  avatarDataUri,
  avatarSvg,
  normalizeAvatarSeed,
  serverAvatarSeed,
  userAvatarSeed,
} from "./svg";

export interface NativeAvatarProps {
  /**
   * Stable seed: use a user id (`userAvatarSeed`) or a server icon seed from
   * the well-known document. Never the display name.
   */
  seed: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Accessible label. When omitted the avatar is decorative. */
  title?: string;
  /** Workspace profile picture. When set, it replaces the generated avatar. */
  src?: string;
  /** `circle` for people, `squircle` for servers and workspaces. */
  shape?: AvatarShape;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Aulora avatar on iOS/Android: the deterministic Blobatar `<svg>` string
 * (`avatarSvg`) rendered through `react-native-svg`'s `SvgXml`. The web
 * entrypoint (`Avatar`) renders the same seed through `@blobatar/react`, so a
 * user looks identical on every client.
 */
function AvatarBody({
  src,
  seed,
  size,
}: {
  readonly src: string | undefined;
  readonly seed: string;
  readonly size: number;
}) {
  const hasSrc = src !== undefined && src.length > 0;
  // The generated SVG is deterministic per (seed, size); memoize it so rows
  // re-rendered for unrelated reasons do not rebuild the blobatar geometry.
  const xml = useMemo(() => (hasSrc ? "" : avatarSvg(seed, { size })), [hasSrc, seed, size]);
  if (hasSrc) {
    return (
      <Image
        source={{ uri: src }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size }}
        resizeMode="cover"
      />
    );
  }
  return <SvgXml xml={xml} width={size} height={size} />;
}

export interface NativeBlobatarProps {
  /**
   * Stable seed: use a user id (`userAvatarSeed`) or a server icon seed from
   * the well-known document. Never the display name.
   */
  seed: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Accessible label. When omitted the creature is decorative. */
  title?: string;
  /** Workspace profile picture. When set, it replaces the generated avatar. */
  src?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The blobatar on its own, with no plate behind it. Use it where the creature
 * is the subject — a hero, an empty state — and {@link NativeAvatar} where it
 * stands in for someone in a list and needs a frame and a ring.
 */
export const NativeBlobatar = memo(function NativeBlobatar({
  seed,
  size = 32,
  title,
  src,
  style,
}: NativeBlobatarProps) {
  return (
    <View
      accessible={title !== undefined}
      accessibilityLabel={title}
      style={[{ width: size, height: size }, style]}
    >
      <AvatarBody src={src} seed={seed} size={size} />
    </View>
  );
});

export const NativeAvatar = memo(function NativeAvatar({
  seed,
  size = 32,
  title,
  src,
  shape = "circle",
  style,
}: NativeAvatarProps) {
  const frameColor =
    useColorScheme() === "light" ? lightPalette["surface-3"] : darkPalette["surface-3"];
  return (
    <View
      accessible={title !== undefined}
      accessibilityLabel={title}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: avatarRadius(size, shape),
          backgroundColor: frameColor,
        },
        style,
      ]}
    >
      <AvatarBody src={src} seed={seed} size={size} />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
