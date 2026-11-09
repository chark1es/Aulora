import { Platform, Text as RNText, View } from "react-native";
import { cn } from "./cn";
import { usePalette } from "./theme";
import { countBadgeTextStyle } from "./variants";

export type CountBadgeTone = "accent" | "muted" | "danger";

export interface CountBadgeProps {
  readonly count: number;
  /** Counts above this collapse to `${max}+`; defaults to 99. */
  readonly max?: number;
  readonly tone?: CountBadgeTone;
  readonly size?: "sm" | "md";
  /** When set the badge is announced on its own; otherwise it is decorative. */
  readonly label?: string;
  readonly className?: string;
}

const SIZE_PX = { sm: 16, md: 20 } as const;

const BACKGROUND: Record<CountBadgeTone, string> = {
  accent: "bg-accent",
  muted: "bg-surface-3",
  danger: "bg-danger",
};

/**
 * A compact numeric pill. It shares one measured line box on iOS and Android so
 * the digits sit optically centred at every size; the caller owns position and
 * any surrounding spacing.
 */
export function CountBadge({
  count,
  max = 99,
  tone = "accent",
  size = "sm",
  label,
  className,
}: CountBadgeProps) {
  const palette = usePalette();
  const dimension = SIZE_PX[size];
  const color =
    tone === "accent"
      ? palette["on-accent"]
      : tone === "danger"
        ? palette.bg
        : palette["text-muted"];
  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? "no-hide-descendants" : "auto"}
      className={cn(
        "items-center justify-center rounded-full px-1",
        BACKGROUND[tone],
        className ?? "",
      )}
      style={{ minWidth: dimension, height: dimension }}
    >
      <RNText
        maxFontSizeMultiplier={1.2}
        style={countBadgeTextStyle({ size: dimension, color, platform: Platform.OS })}
      >
        {count > max ? `${max}+` : String(count)}
      </RNText>
    </View>
  );
}
