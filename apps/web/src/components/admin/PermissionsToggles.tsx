import { Permission } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  togglePermissionBit,
} from "../../lib/workspace-admin";

export interface PermissionsTogglesProps {
  readonly value: bigint;
  readonly onChange: (next: bigint) => void;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/**
 * Grouped permission toggles backed by a single bitfield. Presentational and
 * controlled: the parent owns the value and persists it. Each flag is a
 * checkbox styled as a compact permission chip, so the grid reads as a
 * capability matrix rather than a form.
 */
export function PermissionsToggles({
  value,
  onChange,
  disabled = false,
  testId,
}: PermissionsTogglesProps) {
  return (
    <div className="flex flex-col gap-5" data-testid={testId}>
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {group.label}
            <span className="text-[10px] font-normal normal-case tracking-normal text-text-muted">
              {group.permissions.filter((name) => (value & Permission[name]) !== 0n).length}/
              {group.permissions.length}
            </span>
          </legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {group.permissions.map((name) => {
              const checked = (value & Permission[name]) !== 0n;
              return (
                <label
                  key={name}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-2.5 py-1.5 text-[12px] transition",
                    checked
                      ? "border-accent/40 bg-accent-soft text-text"
                      : "border-border bg-surface-2 text-text-muted hover:border-text-muted/40 hover:text-text",
                    disabled && "pointer-events-none opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(togglePermissionBit(value, name, event.currentTarget.checked))
                    }
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
                      checked ? "border-accent bg-accent text-on-accent" : "border-border",
                    )}
                  >
                    {checked && <Icon name="check" size={11} strokeWidth={3} />}
                  </span>
                  {PERMISSION_LABELS[name]}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
