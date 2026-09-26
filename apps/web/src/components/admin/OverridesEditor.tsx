import { Button, Heading, Text } from "@aulora/ui-web";
import { useEffect, useMemo, useState } from "react";
import {
  type OverrideLevel,
  type OverrideTarget,
  type OverrideView,
  overrideLevel,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  setOverrideLevel,
} from "../../lib/workspace-admin";

export interface OverridesEditorProps {
  readonly title: string;
  readonly overrides: readonly OverrideView[];
  readonly targets: readonly OverrideTarget[];
  readonly onSave: (next: readonly OverrideView[]) => void | Promise<void>;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly testId?: string;
}

const LEVELS: readonly OverrideLevel[] = ["inherit", "allow", "deny"];

/**
 * A category or channel override matrix: pick a role/member target, then set
 * each permission flag to inherit (unset), allow, or deny. `allow`/`deny` stay
 * disjoint because {@link setOverrideLevel} clears the opposite bit.
 */
export function OverridesEditor({
  title,
  overrides,
  targets,
  onSave,
  disabled = false,
  busy = false,
  error = null,
  testId,
}: OverridesEditorProps) {
  const [draft, setDraft] = useState<readonly OverrideView[]>(overrides);
  const [targetKey, setTargetKey] = useState<string>("");

  useEffect(() => {
    setDraft(overrides);
  }, [overrides]);

  const targetMap = useMemo(
    () => new Map(targets.map((target) => [`${target.targetType}:${target.targetId}`, target])),
    [targets],
  );
  const active = targetMap.get(targetKey) ?? null;

  const targetOverrides = active === null ? draft : draft;

  function setLevel(name: Parameters<typeof setOverrideLevel>[2], level: OverrideLevel) {
    if (active === null) {
      return;
    }
    setDraft(setOverrideLevel(targetOverrides, active, name, level));
  }

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex items-center justify-between">
        <Heading level={3}>{title}</Heading>
        <Button
          size="sm"
          loading={busy}
          disabled={disabled || busy}
          onClick={() => void onSave(draft)}
        >
          Save overrides
        </Button>
      </div>

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <label className="flex flex-col gap-1.5 text-sm text-text-muted">
        Target
        <select
          aria-label={`${title} target`}
          className="h-10 rounded-input border border-border bg-surface-3 px-3 text-base text-text"
          value={targetKey}
          disabled={disabled}
          onChange={(event) => setTargetKey(event.currentTarget.value)}
        >
          <option value="">Select a role or member…</option>
          {targets.map((target) => (
            <option
              key={`${target.targetType}:${target.targetId}`}
              value={`${target.targetType}:${target.targetId}`}
            >
              {target.targetType === "role" ? "Role · " : "Member · "}
              {target.label}
            </option>
          ))}
        </select>
      </label>

      {active === null ? (
        <Text tone="muted" size="sm">
          Choose a target to edit its overrides.
        </Text>
      ) : (
        <div className="flex flex-col gap-4" data-testid="override-grid">
          {PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.label} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {group.label}
              </legend>
              {group.permissions.map((name) => {
                const level = overrideLevel(draft, active, name);
                return (
                  <div key={name} className="flex items-center justify-between gap-2 py-0.5">
                    <Text size="sm">{PERMISSION_LABELS[name]}</Text>
                    <div className="flex overflow-hidden rounded-pill border border-border">
                      {LEVELS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={level === option}
                          aria-label={`${PERMISSION_LABELS[name]} ${option}`}
                          disabled={disabled}
                          className={
                            level === option
                              ? "bg-accent px-2 py-0.5 text-xs text-bg"
                              : "bg-surface-3 px-2 py-0.5 text-xs text-text-muted hover:text-text"
                          }
                          onClick={() => setLevel(name, option)}
                        >
                          {option === "inherit" ? "—" : option === "allow" ? "Allow" : "Deny"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Text size="xs" tone="muted" mono>
          ACTIVE OVERRIDES
        </Text>
        {draft.length === 0 ? (
          <Text size="sm" tone="muted">
            None.
          </Text>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="override-list">
            {draft.map((override) => {
              const target = targetMap.get(`${override.targetType}:${override.targetId}`);
              return (
                <li
                  key={`${override.targetType}:${override.targetId}`}
                  className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-1.5"
                >
                  <Text size="sm">
                    {target?.label ?? override.targetId}
                    <Text as="span" size="xs" tone="muted" mono className="ml-2">
                      +{override.allow.toString(2)} −{override.deny.toString(2)}
                    </Text>
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      setDraft(
                        draft.filter(
                          (entry) =>
                            !(
                              entry.targetId === override.targetId &&
                              entry.targetType === override.targetType
                            ),
                        ),
                      )
                    }
                  >
                    Clear
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
