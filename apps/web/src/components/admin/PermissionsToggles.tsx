import { Permission } from "@aulora/core";
import { Text } from "@aulora/ui-web";
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
 * Grouped permission checkboxes backed by a single bitfield. Presentational and
 * controlled: the parent owns the value and persists it.
 */
export function PermissionsToggles({
  value,
  onChange,
  disabled = false,
  testId,
}: PermissionsTogglesProps) {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-1.5" disabled={disabled}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {group.label}
          </legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {group.permissions.map((name) => {
              const checked = (value & Permission[name]) !== 0n;
              return (
                <label
                  key={name}
                  className="flex cursor-pointer items-center gap-2 rounded-input px-2 py-1 text-sm hover:bg-surface-3"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(togglePermissionBit(value, name, event.currentTarget.checked))
                    }
                  />
                  <Text as="span" size="sm">
                    {PERMISSION_LABELS[name]}
                  </Text>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
