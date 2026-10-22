import { Permission } from "@aulora/core";
import { Checkbox, cn } from "@aulora/ui-web";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  togglePermissionBit,
} from "../../lib/workspace-admin";
import type { Callback } from "./callbacks";

const PERMISSION_BITS = new Map<string, bigint>(Object.entries(Permission));
const PERMISSION_LABELS_BY_NAME = new Map<string, string>(Object.entries(PERMISSION_LABELS));

export interface PermissionsTogglesProps {
  readonly value: bigint;
  readonly onChange: Callback<[next: bigint]>;
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
          <legend className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-text">
            {group.label}
            <span className="text-[11px] font-normal text-text-muted">
              {
                group.permissions.filter(
                  (name) => (value & (PERMISSION_BITS.get(name) ?? 0n)) !== 0n,
                ).length
              }
              /{group.permissions.length}
            </span>
          </legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {group.permissions.map((name) => {
              const checked = (value & (PERMISSION_BITS.get(name) ?? 0n)) !== 0n;
              return (
                <label
                  key={name}
                  htmlFor={`permission-${name}`}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[12px] transition",
                    checked
                      ? "bg-accent-soft text-text ring-1 ring-inset ring-accent/40"
                      : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text",
                    disabled && "pointer-events-none opacity-50",
                  )}
                >
                  <Checkbox
                    bare
                    id={`permission-${name}`}
                    label={PERMISSION_LABELS_BY_NAME.get(name) ?? name}
                    checked={checked}
                    disabled={disabled}
                    onChange={(next) => {
                      onChange(togglePermissionBit(value, name, next));
                    }}
                  />
                  {PERMISSION_LABELS_BY_NAME.get(name) ?? name}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
