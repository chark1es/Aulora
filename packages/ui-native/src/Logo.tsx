import Svg, { Circle, Path } from "react-native-svg";
import { usePalette } from "./theme";

export interface LogoProps {
  /** Rendered size in pixels (square). */
  size?: number;
  /** Accessible name; when omitted the mark is decorative. */
  title?: string;
  className?: string;
}

/**
 * The Aulora mark on native: a soft arched doorway (the hall) in Ember with a
 * small moss speech dot, drawn through `react-native-svg`.
 */
export function Logo({ size = 32, title, className }: LogoProps) {
  const palette = usePalette();
  return (
    <Svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      {...(className !== undefined ? { className } : {})}
      {...(title !== undefined ? { accessibilityLabel: title } : {})}
      accessibilityElementsHidden={title === undefined}
      importantForAccessibility={title === undefined ? "no-hide-descendants" : "auto"}
    >
      <Path d="M9 43V25a15 15 0 0 1 30 0v18H9Z" fill={palette.accent} />
      <Path d="M16 43V26a8 8 0 0 1 16 0v17H16Z" fill={palette.bg} />
      <Circle cx={37.5} cy={11.5} r={4} fill={palette.secondary} />
      <Circle cx={37.5} cy={11.5} r={1.4} fill={palette.bg} />
    </Svg>
  );
}
