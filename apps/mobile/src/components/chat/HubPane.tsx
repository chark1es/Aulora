/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { NativeAvatar } from "@aulora/avatars/native";
import type { IconName } from "@aulora/tokens";
import { CountBadge, Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { selectionFeedback } from "../../lib/haptics";
import { useScreenInsets } from "../layout/ScreenContainer";
import { PresenceAvatar } from "./PresenceAvatar";

/** `threads` is the full thread list, opened from the Channels tab rather than the dock. */
export type HubTab = "chats" | "dms" | "boards" | "notes" | "threads" | "search" | "you";

/** Height of the floating dock, used to pad scrolling content clear of it. */
export const DOCK_HEIGHT = 64;

function useCompactDock() {
  const { width, fontScale } = useWindowDimensions();
  const insets = useScreenInsets();
  return width - insets.left - insets.right < 480 || fontScale > 1.3;
}

/** Space a hub tab must leave at its bottom edge so nothing hides under the dock. */
export function useDockClearance(): number {
  const insets = useScreenInsets();
  const compact = useCompactDock();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  return keyboardVisible ? 0 : DOCK_HEIGHT * (compact ? 2 : 1) + Math.max(insets.bottom, 12) + 28;
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

interface TabEntry {
  readonly key: HubTab;
  readonly label: string;
  readonly icon: IconName;
}

const TABS: readonly TabEntry[] = [
  { key: "chats", label: "Channels", icon: "hash" },
  { key: "dms", label: "DMs", icon: "message" },
];

/** Shown only where the workspace’s Kanban addon is on and the viewer may see it. */
const BOARDS_TAB: TabEntry = { key: "boards", label: "Boards", icon: "kanban" };

/** Shown only where the workspace’s Notes addon is on and the viewer may see it. */
const NOTES_TAB: TabEntry = { key: "notes", label: "Notes", icon: "note" };

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
  /** The tab’s glyph: an icon, or the viewer’s own avatar. */
  readonly children: ReactNode;
}

/** Largest text scale for dock labels; they scale with the system setting up to this. */
export const DOCK_LABEL_MAX_SCALE = 1.6;

/** Multi-word labels may wrap to two lines; one word never splits across lines. */
export function dockLabelLines(label: string): 1 | 2 {
  return /\s/.test(label.trim()) ? 2 : 1;
}

const ACTIVE_LABEL_STYLE = { fontSize: 11, lineHeight: 14, fontWeight: "600" } as const;
const IDLE_LABEL_STYLE = { fontSize: 11, lineHeight: 14, fontWeight: "400" } as const;

const DOCK_TAB_BASE =
  "min-h-[52px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-pill";

/** The tab’s glyph with the mention count on its corner. */
function DockTabGlyph({
  badge,
  children,
}: {
  readonly badge: number;
  readonly children: ReactNode;
}) {
  return (
    <View>
      {children}
      {badge > 0 && (
        <View className="absolute -right-3 -top-1">
          <CountBadge count={badge} max={9} size="md" />
        </View>
      )}
    </View>
  );
}

/**
 * Primary navigation stays readable at large text: a label wraps to a second
 * line at a word break, and a single word that still does not fit shrinks a
 * little instead of splitting mid-word or truncating.
 */
function DockTabLabel({ label, active }: { readonly label: string; readonly active: boolean }) {
  return (
    <Text
      style={active ? ACTIVE_LABEL_STYLE : IDLE_LABEL_STYLE}
      tone={active ? "accent" : "muted"}
      className="text-center"
      numberOfLines={dockLabelLines(label)}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      maxFontSizeMultiplier={DOCK_LABEL_MAX_SCALE}
    >
      {label}
    </Text>
  );
}

/** One labelled tab inside the dock’s tab bar. */
function DockTab({ label, active, badge = 0, onPress, children }: DockTabProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} thread mentions` : label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={active ? `${DOCK_TAB_BASE} bg-accent-soft` : DOCK_TAB_BASE}
    >
      <DockTabGlyph badge={badge}>{children}</DockTabGlyph>
      <DockTabLabel label={label} active={active} />
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
  /** Adds the Boards tab. */
  readonly boards?: boolean;
  /** Adds the Notes tab. */
  readonly notes?: boolean;
}

/**
 * The hub’s floating controls, all at thumb height: the tab bar in the middle,
 * the workspace switcher on its own at the leading end and search on its own
 * at the trailing end.
 */
export function HubDock(props: HubDockProps) {
  const { tab, onTab } = props;
  const compact = useCompactDock();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const palette = usePalette();
  const insets = useScreenInsets();
  function select(next: HubTab) {
    if (next !== tab) selectionFeedback();
    onTab(next);
  }
  if (keyboardVisible) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 flex-row items-center justify-center gap-2.5 px-4"
      style={{
        bottom: Math.max(insets.bottom, 12),
        left: insets.left,
        right: insets.right,
        flexWrap: compact ? "wrap" : "nowrap",
      }}
    >
      {!compact && (
        <WorkspaceButton
          name={props.workspaceName}
          seed={props.workspaceSeed}
          onPress={props.onSwitchWorkspace}
        />
      )}
      <View
        accessibilityRole="tablist"
        className="max-w-xs flex-1 flex-row items-center rounded-pill border border-border bg-surface-2 px-1.5 min-w-0"
        style={[
          {
            minHeight: DOCK_HEIGHT,
            ...(compact ? { flexBasis: "100%", maxWidth: "100%" as const } : {}),
          },
          FLOAT_SHADOW,
        ]}
      >
        {[
          ...TABS,
          ...(props.boards === true ? [BOARDS_TAB] : []),
          ...(props.notes === true ? [NOTES_TAB] : []),
        ].map((entry) => {
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
      {compact && (
        <WorkspaceButton
          name={props.workspaceName}
          seed={props.workspaceSeed}
          onPress={props.onSwitchWorkspace}
        />
      )}
      <SearchButton
        active={tab === "search"}
        onPress={() => {
          select("search");
        }}
      />
    </View>
  );
}
