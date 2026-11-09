import { usePalette } from "@aulora/ui-native";
import { View } from "react-native";
import { MemberAvatar } from "./MemberAvatar";

/**
 * Two overlapping faces for a group conversation, with the outer ring matching
 * the surface behind them so the cut-out reads at any size.
 */
export function GroupAvatar({
  userIds,
  size = 36,
  surface,
}: {
  readonly userIds: readonly string[];
  readonly size?: number;
  /** Color behind the pair; defaults to the card surface. */
  readonly surface?: string;
}) {
  const palette = usePalette();
  const ring = surface ?? palette["surface-2"];
  const front = Math.round(size * 0.67);
  const back = Math.round(size * 0.61);
  const [first, second] = userIds;
  if (first === undefined) return null;
  return (
    <View style={{ width: size, height: size }}>
      <MemberAvatar userId={first} size={front} />
      {second !== undefined && (
        <View
          className="absolute bottom-0 right-0 rounded-pill border-2"
          style={{ borderColor: ring }}
        >
          <MemberAvatar userId={second} size={back} />
        </View>
      )}
    </View>
  );
}
