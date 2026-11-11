import { badgeCount } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { CountBadge, Icon, Text, usePalette } from "@aulora/ui-native";
import { Children, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { type RowUnread, rowAccessibilityLabel } from "../../lib/conversation-row";

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
  /** Draws the small inset accent tick used by conversation rows. */
  readonly activeTick?: boolean;
  /** Unread state; mentions become a count pill, plain unread a dot. */
  readonly unread?: RowUnread | undefined;
  /** Muted rows keep legible text instead of losing contrast. */
  readonly muted?: boolean;
  readonly chevron?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly onPress?: (() => void) | undefined;
  readonly onLongPress?: (() => void) | undefined;
}

/** The row’s leading slot: a custom element, a bare glyph, or nothing. */
function RowLeading({
  leading,
  icon,
  color,
}: {
  readonly leading: ReactNode;
  readonly icon: ListRowProps["icon"];
  readonly color: string;
}) {
  if (leading !== undefined && leading !== null) return leading;
  if (icon === undefined) return null;
  return (
    <View className="w-7 items-center">
      <Icon name={icon} size={20} color={color} />
    </View>
  );
}

/** Title over an optional one-line detail. */
function RowLabel({
  title,
  subtitle,
  emphasized,
  color,
}: {
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly emphasized: boolean;
  readonly color: string | undefined;
}) {
  return (
    <View className="min-w-0 flex-1">
      <Text
        numberOfLines={1}
        className={emphasized ? "font-medium" : ""}
        style={color !== undefined ? { color } : undefined}
      >
        {title}
      </Text>
      {subtitle !== undefined && subtitle.length > 0 && (
        <Text size="xs" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/** The quiet inset tick that anchors the selected conversation. */
function ActiveTick() {
  const palette = usePalette();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        left: 4,
        top: "50%",
        marginTop: -6,
        width: 2,
        height: 12,
        borderRadius: 1,
        backgroundColor: palette.accent,
      }}
    />
  );
}

/** The fixed 16pt trailing slot shared by a mention pill and a plain unread dot. */
function UnreadSlot({ unread, muted }: { readonly unread: RowUnread; readonly muted: boolean }) {
  const palette = usePalette();
  const count = badgeCount(unread.mentionCount);
  if (count !== null) {
    return (
      <CountBadge
        count={unread.mentionCount}
        max={99}
        size="sm"
        tone={muted ? "muted" : "accent"}
        className="shrink-0"
      />
    );
  }
  if (!unread.unread) return null;
  return (
    <View className="h-4 w-4 shrink-0 items-center justify-center">
      <View
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: muted ? palette["text-muted"] : palette.accent }}
      />
    </View>
  );
}

/** One tappable row: leading glyph or avatar, title and detail, trailing accessory. */
export function ListRow(props: ListRowProps) {
  const { title, tone = "default", selected = false, disabled = false } = props;
  const palette = usePalette();
  const muted = props.muted === true;
  const tint =
    tone === "danger" ? palette.danger : tone === "accent" || selected ? palette.accent : null;
  const emphasized = selected || (props.unread?.unread === true && !muted);
  const labelColor = selected
    ? undefined
    : tint !== null
      ? tint
      : muted
        ? palette["text-muted"]
        : undefined;
  // A row with nothing to do is plain content, not a button that does nothing.
  const inert = disabled || (props.onPress === undefined && props.onLongPress === undefined);
  return (
    <Pressable
      accessibilityRole={inert && !disabled ? undefined : "button"}
      accessibilityLabel={
        props.accessibilityLabel ?? rowAccessibilityLabel(title, props.unread, muted)
      }
      accessibilityState={{ selected, disabled: inert }}
      disabled={inert}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={280}
      className={`relative min-h-[52px] flex-row items-center gap-3 px-3 py-2 ${
        selected ? "bg-accent-soft active:bg-accent-soft" : "active:bg-surface-3"
      } ${disabled ? "opacity-50" : ""}`}
    >
      {props.activeTick === true && <ActiveTick />}
      <RowLeading leading={props.leading} icon={props.icon} color={tint ?? palette["text-muted"]} />
      <RowLabel
        title={title}
        subtitle={props.subtitle}
        emphasized={emphasized}
        color={labelColor}
      />
      {props.trailing}
      {!selected && props.unread !== undefined && (
        <UnreadSlot unread={props.unread} muted={muted} />
      )}
      {props.chevron === true && (
        <Icon name="chevron-right" size={18} color={palette["text-muted"]} />
      )}
    </Pressable>
  );
}
