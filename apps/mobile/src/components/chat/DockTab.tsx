import { CountBadge, Text } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Fn } from "../../lib/function-type";

export interface DockTabProps {
  readonly label: string;
  readonly active: boolean;
  /** Mentions waiting behind this tab; shown as a count on the glyph. */
  readonly badge?: number;
  readonly onPress: Fn<[], void>;
  /** The tab’s glyph: an icon, or the viewer’s own avatar. */
  readonly children: ReactNode;
}

/** Largest text scale for dock labels; they scale with the system setting up to this. */
export const DOCK_LABEL_MAX_SCALE = 1.6;

/** Multi-word labels may wrap to two lines; one word never splits across lines. */
export function dockLabelLines(label: string) {
  const hasWhitespace = [...label.trim()].some((character) => character.trim().length === 0);
  return hasWhitespace ? 2 : 1;
}

const ACTIVE_LABEL_STYLE = { fontSize: 11, lineHeight: 14, fontWeight: "600" } as const;
const IDLE_LABEL_STYLE = { fontSize: 11, lineHeight: 14, fontWeight: "400" } as const;

const DOCK_TAB_BASE =
  "min-h-[52px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-pill";

/** The tab’s glyph with the mention count on its corner. */
interface DockTabGlyphProps {
  readonly badge: number;
  readonly children: ReactNode;
}

function DockTabGlyph({ badge, children }: DockTabGlyphProps) {
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
interface DockTabLabelProps {
  readonly label: string;
  readonly active: boolean;
}

function DockTabLabel({ label, active }: DockTabLabelProps) {
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
export function DockTab({ label, active, badge = 0, onPress, children }: DockTabProps) {
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
