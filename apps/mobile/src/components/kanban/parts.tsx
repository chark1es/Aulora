import type { IconName } from "@aulora/tokens";
import { Icon, IDLE_COLOR, Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { type BoardMember, type Priority, priorityInfo } from "../../lib/kanban";
import { useReduceMotion } from "../../lib/use-entrance";
import { MemberAvatar } from "../chat/MemberAvatar";

/** The current time, ticking every second only while something needs it. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [ticking]);
  return now;
}

export function usePriorityColor(priority: Priority): string {
  const palette = usePalette();
  const tone = priorityInfo(priority).tone;
  if (tone === "idle") return IDLE_COLOR;
  if (tone === "accent") return palette.accent;
  if (tone === "danger") return palette.danger;
  return palette["text-muted"];
}

export function PriorityFlag({
  priority,
  size = 16,
}: {
  readonly priority: Priority;
  readonly size?: number;
}) {
  const color = usePriorityColor(priority);
  return (
    <View style={{ opacity: priority === "none" ? 0.5 : 1 }}>
      <Icon name="flag" size={size} color={color} />
    </View>
  );
}

/** A square checkbox whose tick pops in. */
export function CheckBox({ checked }: { readonly checked: boolean }) {
  const palette = usePalette();
  const reduced = useReduceMotion();
  const scale = useRef(new Animated.Value(checked ? 1 : 0)).current;
  useEffect(() => {
    if (reduced !== false) {
      scale.setValue(checked ? 1 : 0);
      return;
    }
    Animated.spring(scale, {
      toValue: checked ? 1 : 0,
      speed: 28,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [checked, reduced, scale]);
  return (
    <View
      className={`h-[22px] w-[22px] items-center justify-center rounded-[7px] border ${
        checked ? "border-accent bg-accent" : "border-text-muted"
      }`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name="check" size={16} color={palette["on-accent"]} />
      </Animated.View>
    </View>
  );
}

export function LabelChip({ name, color }: { readonly name: string; readonly color: string }) {
  return (
    <View
      className="max-w-full flex-row items-center gap-1.5 rounded-pill px-2 py-0.5"
      // An 8-digit hex adds ~18% alpha to the label color.
      style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? `${color}2E` : undefined }}
    >
      <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: color }} />
      <Text size="xs" className="shrink font-medium" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/** Overlapping avatars, collapsing the overflow into a count. */
export function AvatarStack({
  userIds,
  members,
  max = 3,
  size = 24,
  ring = "surface-1",
}: {
  readonly userIds: readonly string[];
  readonly members: readonly BoardMember[];
  readonly max?: number;
  readonly size?: number;
  readonly ring?: "surface-1" | "surface-2" | "surface-3";
}) {
  const palette = usePalette();
  if (!userIds.length) return null;
  const names = userIds.map(
    (id) => members.find((member) => member.userId === id)?.displayName ?? "Former member",
  );
  const shown = userIds.slice(0, userIds.length > max ? max - 1 : max);
  const rings = new Map([
    ["surface-1", palette["surface-1"]],
    ["surface-2", palette["surface-2"]],
    ["surface-3", palette["surface-3"]],
  ]);
  const frame = { borderWidth: 2, borderColor: rings.get(ring), borderRadius: 999 };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Assigned to ${names.join(", ")}`}
      className="flex-row items-center"
    >
      {shown.map((id, index) => (
        <View key={id} style={[frame, index > 0 && { marginLeft: -8 }]}>
          <MemberAvatar userId={id} size={size} />
        </View>
      ))}
      {userIds.length > shown.length && (
        <View
          className="items-center justify-center bg-surface-3"
          style={[frame, { marginLeft: -8, width: size + 4, height: size + 4 }]}
        >
          <Text tone="muted" className="text-[11px] font-semibold">
            +{userIds.length - shown.length}
          </Text>
        </View>
      )}
    </View>
  );
}

export function SectionTitle({
  icon,
  title,
  aside,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly aside?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View className="min-h-9 flex-row items-center gap-2">
      <Icon name={icon} size={18} color={palette["text-muted"]} />
      <Text className="flex-1 font-semibold" accessibilityRole="header">
        {title}
      </Text>
      {aside}
    </View>
  );
}

/** One line of a grouped property list: a name, its value, and a way in. */
export function PropertyRow({
  icon,
  label,
  onPress,
  children,
  last = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  /** Omitted when the value cannot be changed. */
  readonly onPress?: (() => void) | undefined;
  readonly children: ReactNode;
  readonly last?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      disabled={onPress === undefined}
      onPress={onPress}
      className={`min-h-12 flex-row items-center gap-3 px-3 py-2 active:bg-surface-3 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <Icon name={icon} size={18} color={palette["text-muted"]} />
      <Text size="sm" tone="muted" className="w-[84px]">
        {label}
      </Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">{children}</View>
      {onPress !== undefined && (
        <Icon name="chevron-right" size={16} color={palette["text-muted"]} />
      )}
    </Pressable>
  );
}
