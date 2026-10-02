/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { NativeAvatar } from "@aulora/avatars/native";
import type { IconName } from "@aulora/tokens";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionFeedback } from "../../lib/haptics";
import { PresenceAvatar } from "./PresenceAvatar";

/** `threads` is the full thread list, opened from the Channels tab rather than the dock. */
export type HubTab = "chats" | "dms" | "threads" | "search" | "you";

/** Height of the floating dock, used to pad scrolling content clear of it. */
export const DOCK_HEIGHT = 64;

/** Space a hub tab must leave at its bottom edge so nothing hides under the dock. */
export function useDockClearance(): number {
  const insets = useSafeAreaInsets();
  return DOCK_HEIGHT + Math.max(insets.bottom, 12) + 16;
}

/** Large left-aligned title shared by every full-screen pane. */
export function PaneHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
      {leading}
      <View className="min-w-0 flex-1">
        <Heading level={2} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {title}
        </Heading>
        {subtitle !== undefined && subtitle.length > 0 && (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}

/** Round 36pt button for a header or section action. */
export function RoundButton({
  icon,
  label,
  onPress,
  tone = "default",
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "default" | "accent";
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-pill active:opacity-70 ${
        tone === "accent" ? "bg-accent" : "bg-surface-2"
      }`}
    >
      <Icon name={icon} size={18} color={tone === "accent" ? palette["on-accent"] : palette.text} />
    </Pressable>
  );
}

const TABS: readonly { readonly key: HubTab; readonly label: string; readonly icon: IconName }[] = [
  { key: "chats", label: "Channels", icon: "hash" },
  { key: "dms", label: "DMs", icon: "message" },
];

const FLOAT_SHADOW = {
  shadowColor: "#000",
  shadowOpacity: 0.16,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
} as const;

interface DockTabProps {
  readonly label: string;
  readonly active: boolean;
  /** Mentions waiting behind this tab; shown as a count on the glyph. */
  readonly badge?: number;
  readonly onPress: () => void;
  /** The tab's glyph: an icon, or the viewer's own avatar. */
  readonly children: ReactNode;
}

/** One labelled tab inside the dock's tab bar. */
function DockTab({ label, active, badge = 0, onPress, children }: DockTabProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} thread mentions` : label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`h-[52px] flex-1 items-center justify-center gap-0.5 rounded-pill ${
        active ? "bg-accent-soft" : ""
      }`}
    >
      <View>
        {children}
        {badge > 0 && (
          <View className="absolute -right-3 -top-1 min-w-[18px] items-center rounded-pill bg-accent px-1">
            <Text
              className="font-bold"
              style={{ color: palette["on-accent"], fontSize: 11, lineHeight: 16 }}
              maxFontSizeMultiplier={1.2}
            >
              {badge > 9 ? "9+" : String(badge)}
            </Text>
          </View>
        )}
      </View>
      <Text
        style={{ fontSize: 11, lineHeight: 14, fontWeight: active ? "600" : "400" }}
        tone={active ? "accent" : "muted"}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface WorkspaceButtonProps {
  readonly name: string;
  readonly seed: string;
  readonly onPress: () => void;
}

/** Opens the workspace switcher. It opens a sheet, so it sits beside the tab bar, not in it. */
function WorkspaceButton({ name, seed, onPress }: WorkspaceButtonProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Switch workspace, current ${name}`}
      onPress={onPress}
      className="items-center justify-center rounded-[20px] border border-border bg-surface-2 active:opacity-70"
      style={[{ width: DOCK_HEIGHT, height: DOCK_HEIGHT }, FLOAT_SHADOW]}
    >
      <NativeAvatar seed={seed} size={38} shape="squircle" />
      <View
        className="absolute bottom-1 right-1 h-[18px] w-[18px] items-center justify-center rounded-pill bg-surface-3"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="chevron-down" size={14} color={palette["text-muted"]} />
      </View>
    </Pressable>
  );
}

interface SearchButtonProps {
  readonly active: boolean;
  readonly onPress: () => void;
}

/** Search on its own at the trailing end of the dock. */
function SearchButton({ active, onPress }: SearchButtonProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel="Search"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`items-center justify-center rounded-pill border border-border active:opacity-70 ${
        active ? "bg-accent" : "bg-surface-2"
      }`}
      style={[{ width: DOCK_HEIGHT, height: DOCK_HEIGHT }, FLOAT_SHADOW]}
    >
      <Icon name="search" size={24} color={active ? palette["on-accent"] : palette.text} />
    </Pressable>
  );
}

export interface HubDockProps {
  readonly tab: HubTab;
  readonly onTab: (tab: HubTab) => void;
  readonly workspaceName: string;
  readonly workspaceSeed: string;
  readonly onSwitchWorkspace: () => void;
  readonly ownUserId: string;
  readonly ownStatus: string;
  readonly threadBadge: number;
}

/**
 * The hub's floating controls, all at thumb height: the tab bar in the middle,
 * the workspace switcher on its own at the leading end and search on its own
 * at the trailing end.
 */
export function HubDock(props: HubDockProps) {
  const { tab, onTab } = props;
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  function select(next: HubTab) {
    if (next !== tab) selectionFeedback();
    onTab(next);
  }
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 flex-row items-center justify-center gap-2.5 px-4"
      style={{ bottom: Math.max(insets.bottom, 12) }}
    >
      <WorkspaceButton
        name={props.workspaceName}
        seed={props.workspaceSeed}
        onPress={props.onSwitchWorkspace}
      />
      <View
        accessibilityRole="tablist"
        className="max-w-xs flex-1 flex-row items-center rounded-pill border border-border bg-surface-2 px-1.5"
        style={[{ height: DOCK_HEIGHT }, FLOAT_SHADOW]}
      >
        {TABS.map((entry) => {
          // The full thread list is reached from Channels, so it keeps that tab lit.
          const active = entry.key === tab || (entry.key === "chats" && tab === "threads");
          return (
            <DockTab
              key={entry.key}
              label={entry.label}
              active={active}
              badge={entry.key === "chats" ? props.threadBadge : 0}
              onPress={() => {
                select(entry.key);
              }}
            >
              <Icon
                name={entry.icon}
                size={22}
                color={active ? palette.accent : palette["text-muted"]}
              />
            </DockTab>
          );
        })}
        <DockTab
          label="You"
          active={tab === "you"}
          onPress={() => {
            select("you");
          }}
        >
          <PresenceAvatar userId={props.ownUserId} status={props.ownStatus} size={22} />
        </DockTab>
      </View>
      <SearchButton
        active={tab === "search"}
        onPress={() => {
          select("search");
        }}
      />
    </View>
  );
}
