import { presenceColor, usePalette } from "@aulora/ui-native";
import { View } from "react-native";
import { presenceLabel } from "../../lib/presence";
import { MemberAvatar } from "./MemberAvatar";

/** A member avatar with their presence as a dot cut into its lower-right edge. */
export function PresenceAvatar({
  userId,
  status,
  size = 36,
  roleColor,
  surface,
}: {
  readonly userId: string;
  readonly status: string;
  readonly size?: number;
  readonly roleColor?: string | null | undefined;
  /** Color of the surface behind the avatar, so the dot reads as a cut-out. */
  readonly surface?: string;
}) {
  const palette = usePalette();
  const dot = Math.max(12, Math.round(size * 0.34));
  const offline = status === "offline";
  const ring = surface ?? palette["surface-2"];
  return (
    <View style={{ width: size, height: size }}>
      <MemberAvatar userId={userId} size={size} roleColor={roleColor ?? null} />
      {/* Offline is a hollow ring, not just a duller dot, so it reads without color. */}
      <View
        accessible
        accessibilityLabel={presenceLabel(status)}
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          padding: 2,
          backgroundColor: ring,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: dot / 2,
            borderWidth: offline ? 2 : 0,
            borderColor: palette["text-muted"],
            backgroundColor: offline ? ring : presenceColor(status, palette),
          }}
        />
      </View>
    </View>
  );
}
