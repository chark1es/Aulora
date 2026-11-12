import {
  describeLightnessChange,
  describeRoleColorRepairChange,
  type ReadableRoleColorSuggestion,
  type RoleColorCheck,
  type RoleColorRepairOutcome,
  type RoleColorTheme,
  roleColorChecks,
  roleColorHeadline,
  roleColorRepairs,
  roleTextColor,
} from "@aulora/core";
import { paletteFor } from "@aulora/tokens";
import { type ReactNode, useId, useMemo } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import type { Fn } from "./function-type";
import { Icon } from "./Icon";

export interface RoleColorPreviewProps {
  /** The role name as it appears in messages and member lists. */
  readonly name?: string;
  /** The picked role color; empty means the theme’s normal text color. */
  readonly color: string;
  /** Show an `@role` pill sample; roles can be mentioned when this is true. */
  readonly mentionable?: boolean;
  readonly disabled?: boolean;
  /** Applies the suggested shade; when omitted the suggestion is not offered. */
  readonly onApplySuggestion?: Fn<[color: string], void>;
  readonly className?: string;
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
 * Live role-color preview: the role name on both real theme surfaces, with the
 * WCAG contrast and a plain-language verdict for each. A one-tap suggestion
 * nudges lightness until the shade is readable, keeping the picked hue.
 *
 * The preview never blocks saving; it exists so an unreadable pick is visible
 * before the role is stored.
 */
export function RoleColorPreview({
  name,
  color,
  mentionable = false,
  disabled = false,
  onApplySuggestion,
  className,
}: RoleColorPreviewProps) {
  const headingId = useId();
  const trimmed = color.trim();
  const sampleName = name?.trim().length ? name.trim() : FALLBACK_NAME;
  const checks = useMemo(() => roleColorChecks(trimmed, SURFACES), [trimmed]);
  const repairs = useMemo(() => roleColorRepairs(trimmed, SURFACES), [trimmed]);
  const headline = trimmed.length === 0 ? "Default text color" : roleColorHeadline(checks);

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-testid="role-color-preview"
    >
      <PreviewHeading headingId={headingId} headline={headline} />

      <ThemeChips checks={checks} color={trimmed} name={sampleName} mentionable={mentionable} />

      <ColorNotes hasColor={trimmed.length > 0} />
      <RepairNotes
        repairs={repairs}
        checks={checks}
        currentColor={trimmed}
        disabled={disabled}
        onApplySuggestion={onApplySuggestion}
      />
    </section>
  );
}

function ThemeChips({
  checks,
  color,
  name,
  mentionable,
}: {
  readonly checks: readonly RoleColorCheck[];
  readonly color: string;
  readonly name: string;
  readonly mentionable: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {SURFACES.map(({ theme, palette }) => {
        const check = color.length === 0 ? undefined : checks.find((item) => item.theme === theme);
        return (
          <ThemeChip
            key={theme}
            theme={theme}
            palette={palette}
            badge={check === undefined ? null : <ContrastBadge check={check} palette={palette} />}
            name={name}
            color={color}
            mentionable={mentionable}
          />
        );
      })}
    </div>
  );
}

function PreviewHeading({
  headingId,
  headline,
}: {
  readonly headingId: string;
  readonly headline: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={headingId} className="text-[12px] font-medium text-text">
        How the role name looks
      </h3>
      <p className="text-[12px] text-text-muted">{headline}</p>
    </div>
  );
}

function ColorNotes({ hasColor }: { readonly hasColor: boolean }) {
  return (
    <>
      {hasColor ? null : (
        <p className="text-[12px] text-text-muted" data-testid="role-color-preview-no-color">
          No color is set, so this role uses the normal text color in both themes.
        </p>
      )}
      {hasColor && (
        <p className="text-[12px] text-text-muted">
          One color can’t be readable on both light and dark; pick the theme most of your members
          use or accept the tradeoff. Suggestions preserve themes that already pass AA.
        </p>
      )}
    </>
  );
}

function RepairNotes({
  repairs,
  checks,
  currentColor,
  disabled,
  onApplySuggestion,
}: {
  readonly repairs: readonly RoleColorRepairOutcome[];
  readonly checks: readonly RoleColorCheck[];
  readonly currentColor: string;
  readonly disabled: boolean;
  readonly onApplySuggestion: Fn<[color: string], void> | undefined;
}) {
  return repairs.map((repair) => {
    if (repair.blockedBy !== null) {
      return (
        <BlockedRepairNote key={repair.theme} theme={repair.theme} blockedBy={repair.blockedBy} />
      );
    }
    const { suggestion } = repair;
    if (onApplySuggestion === undefined) return null;
    return (
      <SuggestionRow
        key={repair.theme}
        theme={repair.theme}
        suggestion={suggestion}
        currentColor={currentColor}
        changes={describeRoleColorRepairChange(checks, suggestion)}
        disabled={disabled}
        onApply={() => {
          onApplySuggestion(suggestion.color);
        }}
      />
    );
  });
}

function ThemeChip({
  theme,
  palette,
  badge,
  name,
  color,
  mentionable,
}: {
  readonly theme: "light" | "dark";
  readonly palette: Palette;
  readonly badge: ReactNode;
  readonly name: string;
  readonly color: string;
  readonly mentionable: boolean;
}) {
  const roleName = roleTextColor(color, palette.text);
  return (
    <figure
      className="min-w-0 rounded-[10px] border p-3"
      data-testid={`role-color-preview-${theme}`}
      style={{
        backgroundColor: palette.chat,
        borderColor: palette.border,
        color: palette.text,
      }}
    >
      <figcaption className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: palette["text-muted"] }}
        >
          {theme === "light" ? "Light" : "Dark"}
        </span>
        {badge}
      </figcaption>
      <RoleNameRow theme={theme} palette={palette} roleName={roleName} name={name} />
      {mentionable && <MentionSample theme={theme} palette={palette} name={name} />}
    </figure>
  );
}

type Palette = ReturnType<typeof paletteFor>;

function RoleNameRow({
  theme,
  palette,
  roleName,
  name,
}: {
  readonly theme: "light" | "dark";
  readonly palette: Palette;
  readonly roleName: string;
  readonly name: string;
}) {
  return (
    <div className="mt-2.5 flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="h-6 w-6 shrink-0 rounded-full"
        style={{
          backgroundColor: roleName,
          boxShadow: `0 0 0 2px ${palette["surface-3"]}`,
        }}
      />
      <span
        className="min-w-0 truncate text-[13px] font-semibold"
        style={{ color: roleName }}
        data-testid={`role-color-preview-name-${theme}`}
      >
        {name}
      </span>
    </div>
  );
}

function MentionSample({
  theme,
  palette,
  name,
}: {
  readonly theme: "light" | "dark";
  readonly palette: Palette;
  readonly name: string;
}) {
  return (
    <div
      className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px]"
      style={{ color: palette["text-muted"] }}
    >
      <span
        className="min-w-0 truncate rounded-[5px] border px-1 font-semibold"
        style={{
          backgroundColor: palette["accent-soft"],
          borderColor: palette.accent,
          color: palette["accent-text"],
        }}
        data-testid={`role-color-preview-mention-${theme}`}
      >
        @{name}
      </span>
      <span className="truncate">mention</span>
    </div>
  );
}

function ContrastBadge({
  check,
  palette,
}: {
  readonly check: RoleColorCheck;
  readonly palette: Palette;
}) {
  const tone =
    check.level === "pass"
      ? palette["secondary-text"]
      : check.level === "low"
        ? palette["accent-text"]
        : palette["danger-text"];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[12px] font-medium"
      style={{ color: tone, borderColor: palette.border }}
      data-testid={`role-color-preview-verdict-${check.theme}`}
    >
      <Icon name={LEVEL_ICONS[check.level]} size={11} />
      <span>
        {check.label} · {check.ratioLabel}
      </span>
    </span>
  );
}

function BlockedRepairNote({
  theme,
  blockedBy,
}: {
  readonly theme: RoleColorTheme;
  readonly blockedBy: RoleColorTheme;
}) {
  return (
    <p
      className="flex min-w-0 items-start gap-1.5 text-[12px] text-text-muted"
      data-testid="role-color-repair-blocked"
    >
      <span className="mt-px shrink-0">
        <Icon name="flag" size={12} />
      </span>
      <span className="min-w-0">
        No shade fixes {theme} without dropping {blockedBy} below 4.5:1. Pick the theme you want to
        prioritize.
      </span>
    </p>
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
    <div
      className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-3"
      data-testid="role-color-suggestion"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12px] font-medium text-text">Readable on {theme}</span>
        <span className="text-[12px] text-text-muted">
          {describeLightnessChange(suggestion.deltaLightness)} · keeps the hue
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <SwatchLabel label="Now" color={currentColor} />
        <span aria-hidden="true" className="text-text-muted">
          →
        </span>
        <SwatchLabel label="Suggested" color={suggestion.color} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={disabled}
          onClick={onApply}
        >
          Make readable on {theme}
        </Button>
      </div>
      <p className="text-[12px] text-text-muted" data-testid="role-color-suggestion-note">
        {changes.join(" · ")}
      </p>
    </div>
  );
}

function SwatchLabel({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted">
      {label}
      <span
        aria-hidden="true"
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono uppercase text-text">{color}</span>
    </span>
  );
}
