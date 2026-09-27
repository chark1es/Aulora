import { cn, Icon } from "@aulora/ui-web";
import type { OverrideLevel } from "../../lib/workspace-admin";

export interface OverrideTriStateProps {
  readonly label: string;
  readonly value: OverrideLevel;
  readonly onChange: (level: OverrideLevel) => void;
  readonly disabled?: boolean;
}

const SEGMENTS = ["inherit", "allow", "deny"] as const satisfies readonly OverrideLevel[];

/** Raised, colored surface for the active segment. */
const INDICATOR: Record<OverrideLevel, string> = {
  inherit: "bg-surface-1 ring-1 ring-border shadow-sm",
  allow: "bg-secondary/20 ring-1 ring-secondary/40 shadow-sm",
  deny: "bg-danger/15 ring-1 ring-danger/40 shadow-sm",
};

const ACTIVE_TEXT: Record<OverrideLevel, string> = {
  inherit: "text-text",
  allow: "text-secondary",
  deny: "text-danger",
};

/**
 * A compact macOS-style segmented control for one override flag: inherit
 * (neutral dash), allow (green check) or deny (red cross). A single sliding
 * pill moves behind the active segment, so the control reads as one object
 * while each state keeps its own color.
 */
export function OverrideTriState({
  label,
  value,
  onChange,
  disabled = false,
}: OverrideTriStateProps) {
  const index = Math.max(0, SEGMENTS.indexOf(value));
  return (
    <fieldset
      aria-label={`${label} override`}
      className={cn(
        "relative m-0 grid w-[92px] shrink-0 grid-cols-3 gap-0.5 rounded-[9px] border border-border bg-surface-3 p-0.5",
        disabled && "opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[6px] transition-[transform,background-color,box-shadow] duration-200 ease-out",
          INDICATOR[value],
        )}
        style={{
          width: "calc((100% - 0.5rem) / 3)",
          transform: `translateX(calc(${index} * (100% + 0.125rem)))`,
        }}
      />
      {SEGMENTS.map((segment) => {
        const active = segment === value;
        return (
          <button
            key={segment}
            type="button"
            aria-pressed={active}
            aria-label={`${label} ${segment}`}
            title={segment === "inherit" ? "Inherit" : segment === "allow" ? "Allow" : "Deny"}
            disabled={disabled}
            onClick={() => onChange(segment)}
            className={cn(
              "relative z-10 flex h-6 items-center justify-center rounded-[6px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active ? ACTIVE_TEXT[segment] : "text-text-muted hover:text-text",
            )}
          >
            {segment === "inherit" ? (
              <span aria-hidden="true" className="h-0.5 w-2.5 rounded-full bg-current" />
            ) : (
              <Icon name={segment === "allow" ? "check" : "x"} size={12} strokeWidth={2.25} />
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
