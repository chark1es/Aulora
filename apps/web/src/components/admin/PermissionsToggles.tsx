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
  /**
   * The bits the viewer may grant. Omit to allow every flag. Flags outside
   * this set can still be removed when the role already has them, but cannot
   * be switched on, so nobody can hand out more power than they hold.
   */
  readonly grantable?: bigint;
  readonly testId?: string;
}

/**
 * Grouped permission toggles backed by a single bitfield. Presentational and
 * controlled: the parent owns the value and persists it. Each flag is a
 * checkbox and label in a flat two-column list, so the grid reads as a
 * capability matrix without a card per row.
 */
export function PermissionsToggles({
  value,
  onChange,
  disabled = false,
  grantable,
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
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {group.permissions.map((name) => {
              const bit = PERMISSION_BITS.get(name) ?? 0n;
              const checked = (value & bit) !== 0n;
              // A checked elevated flag may be removed, but not switched back
              // on: only an actor who holds the bit can grant it.
              const locked = grantable !== undefined && (grantable & bit) !== bit;
              const lockedOut = locked && !checked;
              return (
                <label
                  key={name}
                  htmlFor={`permission-${name}`}
                  title={lockedOut ? "You cannot grant a permission you do not hold." : undefined}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2.5 rounded-[6px] px-1 py-1 text-[12px] transition",
                    checked ? "text-text" : "text-text-muted hover:text-text",
                    (disabled || lockedOut) && "pointer-events-none opacity-50",
                  )}
                >
                  <Checkbox
                    bare
                    id={`permission-${name}`}
                    label={PERMISSION_LABELS_BY_NAME.get(name) ?? name}
                    checked={checked}
                    disabled={disabled || lockedOut}
                    onChange={(next) => {
                      onChange(togglePermissionBit(value, name, next));
                    }}
                  />
                  <span className="min-w-0 flex-1 leading-[18px]">
                    {PERMISSION_LABELS_BY_NAME.get(name) ?? name}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
