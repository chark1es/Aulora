import type { PermissionName } from "@aulora/core";
import { Button, cn, Heading, Icon, Text } from "@aulora/ui-web";
import { useEffect, useId, useMemo, useState } from "react";
import {
  type OverrideLevel,
  type OverrideTarget,
  type OverrideView,
  overrideLevel,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  setOverrideLevel,
} from "../../lib/workspace-admin";
import { Combobox, type ComboboxOption } from "./Combobox";
import type { Callback } from "./callbacks";
import { OverrideTriState } from "./OverrideTriState";

export interface OverridesEditorProps {
  readonly title: string;
  readonly overrides: readonly OverrideView[];
  readonly targets: readonly OverrideTarget[];
  readonly onSave: Callback<[next: readonly OverrideView[]], void | Promise<void>>;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly testId?: string;
}

interface GroupCounts {
  readonly allow: number;
  readonly deny: number;
}

interface FilteredGroup {
  readonly label: string;
  readonly all: readonly PermissionName[];
  readonly permissions: readonly PermissionName[];
}

const PERMISSION_LABELS_BY_NAME = new Map<string, string>(Object.entries(PERMISSION_LABELS));

function permissionLabel(name: PermissionName): string {
  return PERMISSION_LABELS_BY_NAME.get(name) ?? name;
}

function countGroup(
  overrides: readonly OverrideView[],
  target: { targetId: string; targetType: "role" | "member" },
  permissions: readonly PermissionName[],
): GroupCounts {
  let allow = 0;
  let deny = 0;
  for (const name of permissions) {
    const level = overrideLevel(overrides, target, name);
    if (level === "allow") {
      allow += 1;
    } else if (level === "deny") {
      deny += 1;
    }
  }
  return { allow, deny };
}

function flagsFor(
  overrides: readonly OverrideView[],
  target: { targetId: string; targetType: "role" | "member" },
): { readonly allow: readonly PermissionName[]; readonly deny: readonly PermissionName[] } {
  const allow: PermissionName[] = [];
  const deny: PermissionName[] = [];
  for (const group of PERMISSION_GROUPS) {
    for (const name of group.permissions) {
      const level = overrideLevel(overrides, target, name);
      if (level === "allow") {
        allow.push(name);
      } else if (level === "deny") {
        deny.push(name);
      }
    }
  }
  return { allow, deny };
}

function buildTargetOptions(targets: readonly OverrideTarget[]): readonly ComboboxOption[] {
  return targets.map((target) => {
    const hasColor = target.color !== undefined && target.color !== null && target.color.length > 0;
    return {
      value: `${target.targetType}:${target.targetId}`,
      label: target.label,
      description: target.targetType === "role" ? "Role" : "Member",
      keywords: `${target.targetType} ${target.targetId}`,
      leading:
        target.targetType === "role" ? (
          hasColor ? (
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full border border-border"
              style={{ backgroundColor: target.color ?? undefined }}
            />
          ) : (
            <Icon name="shield" size={13} />
          )
        ) : (
          <Icon name="at" size={13} />
        ),
    };
  });
}

function filterPermissionGroups(query: string): FilteredGroup[] {
  const needle = query.trim().toLowerCase();
  return PERMISSION_GROUPS.map((group) => ({
    label: group.label,
    all: group.permissions,
    permissions:
      needle.length === 0
        ? group.permissions
        : group.permissions.filter((name) => permissionLabel(name).toLowerCase().includes(needle)),
  })).filter((group) => group.permissions.length > 0);
}

function countTotals(draft: readonly OverrideView[]): GroupCounts {
  let allow = 0;
  let deny = 0;
  for (const override of draft) {
    const flags = flagsFor(draft, override);
    allow += flags.allow.length;
    deny += flags.deny.length;
  }
  return { allow, deny };
}

/**
 * A category or channel override matrix: pick a role/member target, then set
 * each permission flag to inherit (unset), allow, or deny. `allow`/`deny` stay
 * disjoint because {@link setOverrideLevel} clears the opposite bit.
 */
export function OverridesEditor(props: OverridesEditorProps) {
  const {
    title,
    overrides,
    targets,
    onSave,
    disabled = false,
    busy = false,
    error = null,
    testId,
  } = props;
  const [draft, setDraft] = useState<readonly OverrideView[]>(overrides);
  const [targetKey, setTargetKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(overrides.length <= 3);
  const summaryId = useId();

  useEffect(() => {
    setDraft(overrides);
  }, [overrides]);

  const targetMap = useMemo(
    () => new Map(targets.map((target) => [`${target.targetType}:${target.targetId}`, target])),
    [targets],
  );
  const active = targetMap.get(targetKey) ?? null;

  const targetOptions = useMemo(() => buildTargetOptions(targets), [targets]);
  const filteredGroups = useMemo(() => filterPermissionGroups(query), [query]);
  const totals = useMemo(() => countTotals(draft), [draft]);

  function setLevel(name: PermissionName, level: OverrideLevel) {
    if (active === null) {
      return;
    }
    setDraft((current) => setOverrideLevel(current, active, name, level));
  }

  function setGroup(permissions: readonly PermissionName[], level: OverrideLevel) {
    if (active === null) {
      return;
    }
    setDraft((current) =>
      permissions.reduce((acc, name) => setOverrideLevel(acc, active, name, level), current),
    );
  }

  function clearTarget(override: OverrideView) {
    setDraft((current) =>
      current.filter(
        (entry) =>
          !(entry.targetId === override.targetId && entry.targetType === override.targetType),
      ),
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex items-center justify-between">
        <Heading level={3}>{title}</Heading>
        <Button
          size="sm"
          loading={busy}
          disabled={disabled || busy}
          onClick={() => {
            void onSave(draft);
          }}
        >
          Save overrides
        </Button>
      </div>

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <Combobox
        label="Target"
        aria-label={`${title} target`}
        value={targetKey}
        options={targetOptions}
        placeholder="Select a role or member…"
        searchPlaceholder="Search roles and members…"
        emptyMessage="No matching targets."
        disabled={disabled}
        onChange={(next) => {
          setTargetKey(next);
        }}
      />

      {active === null ? (
        <Text tone="muted" size="sm">
          Choose a target to edit its overrides.
        </Text>
      ) : (
        <OverrideMatrix
          active={active}
          draft={draft}
          query={query}
          onQueryChange={setQuery}
          filteredGroups={filteredGroups}
          disabled={disabled}
          onSetLevel={setLevel}
          onSetGroup={setGroup}
        />
      )}

      <OverrideSummarySection
        summaryOpen={summaryOpen}
        summaryId={summaryId}
        draft={draft}
        totals={totals}
        targetMap={targetMap}
        disabled={disabled}
        onToggle={() => {
          setSummaryOpen((open) => !open);
        }}
        onClear={clearTarget}
      />
    </div>
  );
}

interface OverrideMatrixProps {
  readonly active: OverrideTarget;
  readonly draft: readonly OverrideView[];
  readonly query: string;
  readonly onQueryChange: Callback<[value: string]>;
  readonly filteredGroups: readonly FilteredGroup[];
  readonly disabled: boolean;
  readonly onSetLevel: Callback<[name: PermissionName, level: OverrideLevel]>;
  readonly onSetGroup: Callback<[permissions: readonly PermissionName[], level: OverrideLevel]>;
}

function OverrideMatrix(props: OverrideMatrixProps) {
  const { active, draft, query, onQueryChange, filteredGroups, disabled, onSetLevel, onSetGroup } =
    props;
  return (
    <div className="flex flex-col gap-4" data-testid="override-grid">
      <TargetHeader target={active} />

      <div className="flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-2.5 transition focus-within:border-accent">
        <Icon name="search" size={14} className="shrink-0 text-text-muted" />
        <input
          type="text"
          value={query}
          aria-label="Filter permissions"
          placeholder="Filter permissions…"
          disabled={disabled}
          onChange={(event) => {
            onQueryChange(event.currentTarget.value);
          }}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-text placeholder:text-text-muted focus:outline-none disabled:opacity-50"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => {
              onQueryChange("");
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {filteredGroups.length === 0 ? (
        <Text tone="muted" size="sm">
          No permissions match “{query.trim()}”.
        </Text>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredGroups.map((group) => (
            <OverrideGroupCard
              key={group.label}
              group={group}
              draft={draft}
              active={active}
              disabled={disabled}
              onSetLevel={onSetLevel}
              onSetGroup={onSetGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverrideGroupCard({
  group,
  draft,
  active,
  disabled,
  onSetLevel,
  onSetGroup,
}: {
  readonly group: FilteredGroup;
  readonly draft: readonly OverrideView[];
  readonly active: OverrideTarget;
  readonly disabled: boolean;
  readonly onSetLevel: Callback<[name: PermissionName, level: OverrideLevel]>;
  readonly onSetGroup: Callback<[permissions: readonly PermissionName[], level: OverrideLevel]>;
}) {
  const counts = countGroup(draft, active, group.all);
  return (
    <section className="overflow-clip rounded-[12px] border border-border bg-surface-2">
      <header className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-border bg-surface-2/95 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Text
            as="h4"
            size="xs"
            tone="muted"
            className="font-semibold uppercase tracking-[0.06em]"
          >
            {group.label}
          </Text>
          <GroupPills counts={counts} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onSetGroup(group.all, "allow");
            }}
            className="rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-secondary disabled:pointer-events-none disabled:opacity-40"
          >
            Allow all
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onSetGroup(group.all, "inherit");
            }}
            className="rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text disabled:pointer-events-none disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </header>
      <div className="divide-y divide-border">
        {group.permissions.map((name) => {
          const level = overrideLevel(draft, active, name);
          return (
            <div
              key={name}
              className="flex items-center justify-between gap-3 px-3 py-1.5 transition-colors hover:bg-surface-3/40"
            >
              <Text size="sm" className="min-w-0 truncate">
                {permissionLabel(name)}
              </Text>
              <OverrideTriState
                label={permissionLabel(name)}
                value={level}
                disabled={disabled}
                onChange={(next) => {
                  onSetLevel(name, next);
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface OverrideSummarySectionProps {
  readonly summaryOpen: boolean;
  readonly summaryId: string;
  readonly draft: readonly OverrideView[];
  readonly totals: GroupCounts;
  readonly targetMap: ReadonlyMap<string, OverrideTarget>;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onClear: Callback<[override: OverrideView]>;
}

function OverrideSummarySection(props: OverrideSummarySectionProps) {
  const { summaryOpen, summaryId, draft, totals, targetMap, disabled, onToggle, onClear } = props;
  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-surface-2">
      <button
        type="button"
        aria-expanded={summaryOpen}
        aria-controls={summaryId}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left transition hover:bg-surface-3/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Text as="span" size="xs" tone="muted" mono className="uppercase tracking-[0.06em]">
            Active overrides
          </Text>
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            {draft.length}
          </span>
          {totals.allow > 0 && (
            <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
              {totals.allow} allow
            </span>
          )}
          {totals.deny > 0 && (
            <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
              {totals.deny} deny
            </span>
          )}
        </span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            summaryOpen && "rotate-180",
          )}
        />
      </button>

      {summaryOpen && (
        <div id={summaryId} className="animate-fade-in border-t border-border px-2.5 py-2.5">
          {draft.length === 0 ? (
            <Text size="sm" tone="muted">
              No overrides on this scope. Unset flags inherit.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="override-list">
              {draft.map((override) => (
                <OverrideSummaryRow
                  key={`${override.targetType}:${override.targetId}`}
                  override={override}
                  target={targetMap.get(`${override.targetType}:${override.targetId}`)}
                  flags={flagsFor(draft, override)}
                  disabled={disabled}
                  onClear={() => {
                    onClear(override);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function TargetHeader({ target }: { readonly target: OverrideTarget }) {
  const hasColor = target.color !== undefined && target.color !== null && target.color.length > 0;
  return (
    <div className="flex animate-pop-in items-center gap-3 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-border text-text-muted"
        style={hasColor ? { backgroundColor: target.color ?? undefined } : undefined}
      >
        {!hasColor && <Icon name={target.targetType === "role" ? "shield" : "at"} size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Text as="span" size="sm" className="truncate font-semibold">
            {target.label}
          </Text>
          <span className="shrink-0 rounded-[5px] border border-border px-1 py-px text-[10px] uppercase tracking-wide text-text-muted">
            {target.targetType === "role" ? "Role" : "Member"}
          </span>
        </div>
        <Text size="xs" tone="muted" className="truncate">
          Overrides apply to this target.
        </Text>
        <Text size="xs" tone="muted" className="truncate">
          Unset flags inherit from the workspace and category.
        </Text>
      </div>
    </div>
  );
}

function GroupPills({ counts }: { readonly counts: GroupCounts }) {
  if (counts.allow === 0 && counts.deny === 0) {
    return (
      <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-muted">
        inherit
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {counts.allow > 0 && (
        <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
          {counts.allow} allow
        </span>
      )}
      {counts.deny > 0 && (
        <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
          {counts.deny} deny
        </span>
      )}
    </span>
  );
}

function OverrideSummaryRow({
  override,
  target,
  flags,
  disabled,
  onClear,
}: {
  readonly override: OverrideView;
  readonly target: OverrideTarget | undefined;
  readonly flags: {
    readonly allow: readonly PermissionName[];
    readonly deny: readonly PermissionName[];
  };
  readonly disabled: boolean;
  readonly onClear: () => void;
}) {
  const label = target?.label ?? override.targetId;
  const hasColor = target?.color !== undefined && target.color !== null && target.color.length > 0;
  return (
    <li className="rounded-[10px] border border-border bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-border text-text-muted",
              hasColor && "border-transparent",
            )}
            style={hasColor ? { backgroundColor: target.color } : undefined}
          >
            {!hasColor && (
              <Icon name={override.targetType === "role" ? "shield" : "at"} size={11} />
            )}
          </span>
          <Text as="span" size="sm" className="truncate font-medium">
            {label}
          </Text>
          <span className="shrink-0 rounded-[5px] border border-border px-1 py-px text-[10px] uppercase tracking-wide text-text-muted">
            {override.targetType === "role" ? "Role" : "Member"}
          </span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      {(flags.allow.length > 0 || flags.deny.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
          {flags.allow.map((name) => (
            <FlagChip key={`allow-${name}`} state="allow" name={name} />
          ))}
          {flags.deny.map((name) => (
            <FlagChip key={`deny-${name}`} state="deny" name={name} />
          ))}
        </div>
      )}
    </li>
  );
}

function FlagChip({
  state,
  name,
}: {
  readonly state: "allow" | "deny";
  readonly name: PermissionName;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        state === "allow"
          ? "border-secondary/30 bg-secondary/10 text-secondary"
          : "border-danger/30 bg-danger/10 text-danger",
      )}
    >
      <Icon name={state === "allow" ? "check" : "x"} size={10} />
      {permissionLabel(name)}
    </span>
  );
}
