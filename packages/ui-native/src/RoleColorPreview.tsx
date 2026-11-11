import {
  describeLightnessChange,
  describeRoleColorRepairChange,
  type ReadableRoleColorSuggestion,
  type RoleColorCheck,
  type RoleColorTheme,
  roleColorChecks,
  roleColorHeadline,
  roleColorRepairs,
  roleTextColor,
} from "@aulora/core/role-color";
import { paletteFor } from "@aulora/tokens";
import { useMemo } from "react";
import { Text as RNText, useWindowDimensions, View } from "react-native";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { usePalette } from "./theme";
import { nativeFontStyle } from "./typography";

export interface RoleColorPreviewProps {
  /** The role name as it appears in messages and member lists. */
  readonly name?: string;
  /** The picked role color; empty means the theme’s normal text color. */
  readonly color: string;
  /** Show an `@role` pill sample; roles can be mentioned when this is true. */
  readonly mentionable?: boolean;
  readonly disabled?: boolean;
  /** Applies the suggested shade; when omitted the suggestion is not offered. */
  readonly onApplySuggestion?: (color: string) => void;
}

const FALLBACK_NAME = "Moderator";

const LIGHT = paletteFor("light");
const DARK = paletteFor("dark");

const SURFACES = [
  { theme: "light" as const, palette: LIGHT, background: LIGHT.chat },
  { theme: "dark" as const, palette: DARK, background: DARK.chat },
] as const;

const LEVEL_ICONS = {
  pass: "check",
  low: "flag",
  fail: "ban",
} as const;

/**
 * Live role-color preview for native: the role name on both real theme
 * surfaces, with the WCAG contrast and a plain-language verdict for each. A
 * one-tap suggestion nudges lightness until the shade is readable, keeping the
 * picked hue. The preview warns; it never blocks saving.
 */
export function RoleColorPreview({
  name,
  color,
  mentionable = false,
  disabled = false,
  onApplySuggestion,
}: RoleColorPreviewProps) {
  const { width } = useWindowDimensions();
  const stacked = width < 600;
  const trimmed = color.trim();
  const sampleName = name?.trim().length ? name.trim() : FALLBACK_NAME;
  const checks = useMemo(() => roleColorChecks(trimmed, SURFACES), [trimmed]);
  const repairs = useMemo(() => roleColorRepairs(trimmed, SURFACES), [trimmed]);
  const headline = trimmed.length === 0 ? "Default text color" : roleColorHeadline(checks);

  return (
    <View
      className="min-w-0 gap-2"
      accessibilityLabel="Role color preview"
      testID="role-color-preview"
    >
      <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Text size="xs" className="font-semibold">
          How the role name looks
        </Text>
        <Text size="xs" tone="muted">
          {headline}
        </Text>
      </View>

      <View className={stacked ? "gap-2" : "flex-row gap-2"}>
        {SURFACES.map(({ theme, palette, background }, index) => (
          <ThemeChip
            key={theme}
            theme={theme}
            palette={palette}
            background={background}
            check={trimmed.length === 0 ? undefined : checks[index]}
            name={sampleName}
            color={trimmed}
            mentionable={mentionable}
            stacked={stacked}
          />
        ))}
      </View>

      {trimmed.length === 0 ? (
        <Text size="xs" tone="muted" testID="role-color-preview-no-color">
          No color is set, so this role uses the normal text color in both themes.
        </Text>
      ) : null}

      {trimmed.length > 0 && (
        <Text size="xs" tone="muted">
          One color can’t be readable on both light and dark; pick the theme most of your members
          use or accept the tradeoff. Suggestions preserve themes that already pass AA.
        </Text>
      )}
      {repairs.map((repair) => {
        if (repair.blockedBy !== null) {
          return (
            <BlockedRepairNote
              key={repair.theme}
              theme={repair.theme}
              blockedBy={repair.blockedBy}
            />
          );
        }
        const { suggestion } = repair;
        if (onApplySuggestion === undefined) return null;
        return (
          <SuggestionRow
            key={repair.theme}
            theme={repair.theme}
            suggestion={suggestion}
            currentColor={trimmed}
            changes={describeRoleColorRepairChange(checks, suggestion)}
            disabled={disabled}
            onApply={() => {
              onApplySuggestion(suggestion.color);
            }}
          />
        );
      })}
    </View>
  );
}

function ThemeChip({
  theme,
  palette,
  background,
  check,
  name,
  color,
  mentionable,
  stacked,
}: {
  readonly theme: "light" | "dark";
  readonly palette: ReturnType<typeof paletteFor>;
  readonly background: string;
  readonly check: RoleColorCheck | undefined;
  readonly name: string;
  readonly color: string;
  readonly mentionable: boolean;
  readonly stacked: boolean;
}) {
  const roleName = roleTextColor(color, palette.text);
  const verdict = check === undefined ? "" : `${check.label}, ${check.ratioLabel} contrast.`;
  return (
    <View
      className="min-w-0 rounded-card border p-3"
      style={{
        backgroundColor: background,
        borderColor: palette.border,
        flex: stacked ? undefined : 1,
      }}
      accessible
      accessibilityLabel={`${theme === "light" ? "Light" : "Dark"} theme preview: ${name}. ${verdict}`}
      testID={`role-color-preview-${theme}`}
    >
      <View className="min-w-0 flex-row flex-wrap items-center justify-between gap-2">
        <RNText
          style={[
            nativeFontStyle({ fontWeight: "600" }),
            {
              color: palette["text-muted"],
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            },
          ]}
        >
          {theme === "light" ? "Light" : "Dark"}
        </RNText>
        {check !== undefined && <ContrastBadge check={check} palette={palette} />}
      </View>
      <View className="mt-2.5 min-w-0 flex-row items-center gap-2">
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: roleName,
            borderWidth: 2,
            borderColor: palette["surface-3"],
          }}
        />
        <RNText
          numberOfLines={1}
          style={[
            nativeFontStyle({ fontWeight: "600" }),
            { flexShrink: 1, minWidth: 0, color: roleName, fontSize: 13, fontWeight: "600" },
          ]}
          testID={`role-color-preview-name-${theme}`}
        >
          {name}
        </RNText>
      </View>
      {mentionable && (
        <View className="mt-2 min-w-0 flex-row items-center gap-1.5">
          <View
            style={{
              minWidth: 0,
              borderRadius: 5,
              borderWidth: 1,
              paddingHorizontal: 4,
              backgroundColor: palette["accent-soft"],
              borderColor: palette.accent,
            }}
            testID={`role-color-preview-mention-${theme}`}
          >
            <RNText
              numberOfLines={1}
              style={[
                nativeFontStyle({ fontWeight: "600" }),
                { color: palette["accent-text"], fontSize: 12, fontWeight: "600" },
              ]}
            >
              @{name}
            </RNText>
          </View>
          <RNText style={[nativeFontStyle({}), { color: palette["text-muted"], fontSize: 12 }]}>
            mention
          </RNText>
        </View>
      )}
    </View>
  );
}

function ContrastBadge({
  check,
  palette,
}: {
  readonly check: RoleColorCheck;
  readonly palette: ReturnType<typeof paletteFor>;
}) {
  const tone =
    check.level === "pass"
      ? palette["secondary-text"]
      : check.level === "low"
        ? palette["accent-text"]
        : palette["danger-text"];
  return (
    <View
      className="flex-row items-center gap-1 rounded-pill border px-1.5 py-0.5"
      style={{ borderColor: palette.border }}
      testID={`role-color-preview-verdict-${check.theme}`}
    >
      <Icon name={LEVEL_ICONS[check.level]} size={11} color={tone} />
      <RNText
        style={[
          nativeFontStyle({ fontWeight: "500" }),
          { color: tone, fontSize: 12, fontWeight: "500" },
        ]}
      >
        {check.label} · {check.ratioLabel}
      </RNText>
    </View>
  );
}

function BlockedRepairNote({
  theme,
  blockedBy,
}: {
  readonly theme: RoleColorTheme;
  readonly blockedBy: RoleColorTheme;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-start gap-1.5" testID="role-color-repair-blocked">
      <View className="pt-0.5">
        <Icon name="flag" size={12} color={palette["text-muted"]} />
      </View>
      <Text size="xs" tone="muted" className="min-w-0 flex-1">
        No shade fixes {theme} without dropping {blockedBy} below 4.5:1. Pick the theme you want to
        prioritize.
      </Text>
    </View>
  );
}

function SuggestionRow({
  theme,
  suggestion,
  currentColor,
  changes,
  disabled,
  onApply,
}: {
  readonly theme: RoleColorTheme;
  readonly suggestion: ReadableRoleColorSuggestion;
  readonly currentColor: string;
  /** Before/after contrast on every theme, so the other theme's change is visible. */
  readonly changes: readonly string[];
  readonly disabled: boolean;
  readonly onApply: () => void;
}) {
  return (
    <View className="gap-2 rounded-card border border-border bg-surface-2 p-3">
      <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Text size="xs" className="font-semibold">
          Readable on {theme}
        </Text>
        <Text size="xs" tone="muted">
          {describeLightnessChange(suggestion.deltaLightness)} · keeps the hue
        </Text>
      </View>
      <View className="gap-2">
        <SwatchRow label="Now" color={currentColor} />
        <SwatchRow label="Suggested" color={suggestion.color} />
      </View>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onPress={onApply}
        accessibilityLabel={`Use the suggested shade ${suggestion.color}`}
      >
        Make readable on {theme}
      </Button>
      <Text size="xs" tone="muted" testID="role-color-suggestion-note">
        {changes.join(" · ")}
      </Text>
    </View>
  );
}

function SwatchRow({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
      {/* A floor, not a fixed width: at large text "Suggested" grows instead of breaking mid-word. */}
      <Text size="xs" tone="muted" className="min-w-20 shrink-0">
        {label}
      </Text>
      <View
        style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color }}
        className="border border-border"
      />
      <Text size="xs" mono className="uppercase">
        {color}
      </Text>
    </View>
  );
}
