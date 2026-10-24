/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  BOT_BLOCKED_PERMISSIONS,
  BOT_GRANTABLE_PERMISSIONS,
  Permission,
  type PermissionName,
  permissionNames,
} from "@aulora/core";
import { Checkbox, cn, Text } from "@aulora/ui-web";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  togglePermissionBit,
} from "../../../lib/workspace-admin";
import { BOT_BLOCKED_REASONS, BOT_CAUTION_PERMISSIONS } from "./bot-format";

const PERMISSION_BITS = new Map<string, bigint>(Object.entries(Permission));
const PERMISSION_LABELS_BY_NAME = new Map<string, string>(Object.entries(PERMISSION_LABELS));
const GRANTABLE = new Set<PermissionName>(permissionNames(BOT_GRANTABLE_PERMISSIONS));
const BLOCKED = permissionNames(BOT_BLOCKED_PERMISSIONS);

function labelFor(name: PermissionName): string {
  return PERMISSION_LABELS_BY_NAME.get(name) ?? name;
}

interface BotGrantRowProps {
  readonly name: PermissionName;
  readonly value: bigint;
  readonly disabled: boolean;
  readonly onChange: (next: bigint) => void;
}

function BotGrantRow({ name, value, disabled, onChange }: BotGrantRowProps) {
  const checked = (value & (PERMISSION_BITS.get(name) ?? 0n)) !== 0n;
  const caution = BOT_CAUTION_PERMISSIONS.get(name);
  return (
    <label
      htmlFor={`bot-permission-${name}`}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-[9px] border px-2.5 py-1.5 text-[12px] transition",
        checked
          ? "border-accent/40 bg-accent-soft text-text"
          : "border-border bg-surface-2 text-text-muted hover:border-text-muted/40 hover:text-text",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="mt-0.5">
        <Checkbox
          bare
          id={`bot-permission-${name}`}
          label={labelFor(name)}
          checked={checked}
          disabled={disabled}
          onChange={(next) => {
            onChange(togglePermissionBit(value, name, next));
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{labelFor(name)}</span>
        {caution !== undefined && (
          <span className="mt-0.5 block text-[10px] leading-snug text-danger">{caution}</span>
        )}
      </span>
    </label>
  );
}

export interface BotGrantsGridProps {
  readonly value: bigint;
  readonly disabled: boolean;
  readonly onChange: (next: bigint) => void;
}

/** Grantable permissions grouped exactly as the role editor groups them. */
export function BotGrantsGrid({ value, disabled, onChange }: BotGrantsGridProps) {
  return (
    <div className="flex flex-col gap-5">
      {PERMISSION_GROUPS.map((group) => {
        const permissions = group.permissions.filter((name) => GRANTABLE.has(name));
        if (permissions.length === 0) {
          return null;
        }
        return (
          <fieldset key={group.label} className="flex flex-col gap-2" disabled={disabled}>
            <legend className="mb-1 text-[13px] font-semibold text-text">{group.label}</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {permissions.map((name) => (
                <BotGrantRow
                  key={name}
                  name={name}
                  value={value}
                  disabled={disabled}
                  onChange={onChange}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** The bits a bot can never hold, with the reason, shown non-interactive. */
export function BotBlockedPermissions() {
  return (
    <section className="flex flex-col gap-2" aria-label="Permissions bots cannot have">
      <Text as="h4" size="xs" className="font-semibold text-text">
        Never available to bots
      </Text>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {BLOCKED.map((name) => (
          <li
            key={name}
            className="flex items-start gap-2.5 rounded-[9px] border border-border bg-surface-2 px-2.5 py-1.5 opacity-60"
          >
            <span className="mt-0.5">
              <Checkbox
                bare
                id={`bot-blocked-${name}`}
                label={labelFor(name)}
                checked={false}
                disabled
                onChange={() => {
                  // Display only: a blocked permission can never be granted.
                }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-text-muted">{labelFor(name)}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-text-muted">
                {BOT_BLOCKED_REASONS.get(name) ?? "Bots can never have this permission."}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
