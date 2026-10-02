import type { IconName } from "@aulora/tokens";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/** Small caps label above a group, with an optional action on the right. */
export function ListHeader({
  title,
  action,
}: {
  readonly title: string;
  readonly action?: ReactNode;
}) {
  return (
    <View className="min-h-9 flex-row items-end justify-between pb-1.5 pl-4 pr-1">
      <Text
        size="sm"
        tone="muted"
        className="font-semibold"
        accessibilityRole="header"
        maxFontSizeMultiplier={1.5}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

/** An inset card of rows separated by hairlines that start after the leading slot. */
export function ListGroup({
  children,
  inset = 52,
}: {
  readonly children: ReactNode;
  /** Left offset of the separators; match the rows' leading slot. */
  readonly inset?: number;
}) {
  const rows = Children.toArray(children);
  return (
    <View className="overflow-hidden rounded-card bg-surface-2">
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within a static group
        <View key={index}>
          {index > 0 && (
            <View
              className="bg-border"
              style={{ height: StyleSheet.hairlineWidth, marginLeft: inset }}
            />
          )}
          {row}
        </View>
      ))}
    </View>
  );
}

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Glyph drawn in the leading slot; ignored when `leading` is given. */
  readonly icon?: IconName;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly tone?: "default" | "danger" | "accent";
  readonly selected?: boolean;
  readonly chevron?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly onPress?: (() => void) | undefined;
  readonly onLongPress?: (() => void) | undefined;
}

/** One tappable row: leading glyph or avatar, title and detail, trailing accessory. */
export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  trailing,
  tone = "default",
  selected = false,
  chevron = false,
  disabled = false,
  accessibilityLabel,
  onPress,
  onLongPress,
}: ListRowProps) {
  const palette = usePalette();
  const tint =
    tone === "danger" ? palette.danger : tone === "accent" || selected ? palette.accent : null;
  // A row with nothing to do is plain content, not a button that does nothing.
  const inert = disabled || (onPress === undefined && onLongPress === undefined);
  return (
    <Pressable
      accessibilityRole={inert && !disabled ? undefined : "button"}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected, disabled: inert }}
      disabled={inert}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      className={`min-h-[52px] flex-row items-center gap-3 px-3 py-2 active:bg-surface-3 ${
        selected ? "bg-accent-soft" : ""
      } ${disabled ? "opacity-50" : ""}`}
    >
      {leading ??
        (icon !== undefined && (
          <View className="w-7 items-center">
            <Icon name={icon} size={20} color={tint ?? palette["text-muted"]} />
          </View>
        ))}
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className={selected ? "font-semibold" : ""}
          style={tint !== null && tone !== "default" ? { color: tint } : undefined}
        >
          {title}
        </Text>
        {subtitle !== undefined && subtitle.length > 0 && (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Icon name="chevron-right" size={18} color={palette["text-muted"]} />}
    </Pressable>
  );
}
