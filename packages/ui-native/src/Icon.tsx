import { type IconName, iconPaths } from "@aulora/tokens";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

const ICON_PATHS = new Map<IconName, readonly string[]>(
  Object.entries(iconPaths) as Array<[IconName, readonly string[]]>,
);

export interface IconProps {
  name: IconName;
  /** Rendered size in points (square). */
  size?: number;
  color: string;
}

/**
 * A shared Material Symbols icon from `@aulora/tokens`, drawn with react-native-svg so
 * it matches the web icon exactly. Decorative: label the pressable around it.
 * The SVG is wrapped in an exactly-sized, centred box so it never offsets its
 * row when the glyph's path bounds are smaller than the view box.
 */
export function Icon({ name, size = 22, color }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {ICON_PATHS.get(name)?.map((d) => (
          <Path key={d} d={d} />
        ))}
      </Svg>
    </View>
  );
}
