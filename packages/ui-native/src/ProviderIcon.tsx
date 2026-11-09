import { brandIcons, type ProviderBrand } from "@aulora/tokens";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

export interface ProviderIconProps {
  readonly brand: ProviderBrand;
  /** Rendered size in points (square). */
  readonly size?: number;
  /** Colour used by the monochrome marks (`"currentColor"` on the web). */
  readonly color: string;
}

/**
 * A provider's real brand mark, mirroring the web mark. Decorative: the
 * pressable around it carries the accessible name.
 */
export function ProviderIcon({ brand, size = 18, color }: ProviderIconProps) {
  const icon = brandIcons[brand];
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {icon.paths.map((path) => (
          <Path key={path.d} d={path.d} fill={path.fill === "currentColor" ? color : path.fill} />
        ))}
      </Svg>
    </View>
  );
}
