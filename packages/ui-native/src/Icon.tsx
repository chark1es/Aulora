import { type IconName, iconPaths } from "@aulora/tokens";
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
 */
export function Icon({ name, size = 22, color, strokeWidth = 1.75 }: IconProps) {
  return (
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
  );
}
