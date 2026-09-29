import { type IconName, iconPaths } from "@aulora/tokens";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

export interface IconProps {
  name: IconName;
  /** Rendered size in points (square). */
  size?: number;
  color: string;
  strokeWidth?: number;
}

/**
 * A shared stroke icon from `@aulora/tokens`, drawn with react-native-svg so
 * it matches the web icon exactly. Decorative: label the pressable around it.
 * The SVG is wrapped in an exactly-sized, centred box so it never offsets its
 * row when the glyph's path bounds are smaller than the view box.
 */
export function Icon({ name, size = 22, color, strokeWidth = 1.75 }: IconProps) {
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
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {iconPaths[name].map((d) => (
          <Path key={d} d={d} />
        ))}
      </Svg>
    </View>
  );
}
