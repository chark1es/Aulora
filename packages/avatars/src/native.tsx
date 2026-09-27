import { darkPalette } from "@aulora/tokens";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import { type AvatarShape, avatarRadius } from "./shape";
import { avatarSvg } from "./svg";

export interface NativeAvatarProps {
  /**
   * Stable seed: use a user id (`userAvatarSeed`) or a server icon seed from
   * the well-known document. Never the display name.
   */
  seed: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Role color; when set, draws a 2px ring around the avatar. */
  roleColor?: string;
  /** Accessible label. When omitted the avatar is decorative. */
  title?: string;
  /** `circle` for people, `squircle` for servers and workspaces. */
  shape?: AvatarShape;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Aulora avatar on iOS/Android: the deterministic Blobatar `<svg>` string
 * (`avatarSvg`) rendered through `react-native-svg`'s `SvgXml`, with an
 * optional 2px role-color ring. The web entrypoint (`Avatar`) renders the same
 * seed through `@blobatar/react`, so a user looks identical on every client.
 */
export function NativeAvatar({
  seed,
  size = 32,
  roleColor,
  title,
  shape = "circle",
  style,
}: NativeAvatarProps) {
  const ring: ViewStyle | null =
    roleColor !== undefined && roleColor.length > 0
      ? { borderColor: roleColor, borderWidth: 2 }
      : null;
  return (
    <View
      accessible={title !== undefined}
      accessibilityLabel={title}
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: avatarRadius(size, shape) },
        ring,
        style,
      ]}
    >
      <SvgXml xml={avatarSvg(seed, { size })} width={size} height={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: darkPalette["surface-3"],
  },
});
