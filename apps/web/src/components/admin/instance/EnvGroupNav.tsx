/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Text } from "@aulora/ui-web";
import type { EnvGroupSummary } from "../../../lib/instance-env";

export interface EnvGroupNavProps {
  readonly groups: readonly EnvGroupSummary[];
  readonly activeGroup: string;
  readonly onSelect: (groupId: string) => void;
}

/**
 * Group navigation for the Environment section. It is a horizontal strip of
 * chips on narrow viewports and a vertical list with per-group counts and an
 * “N overridden” badge on wide ones; one element reflows, so there is no
 * duplicated DOM.
 */
export function EnvGroupNav({ groups, activeGroup, onSelect }: EnvGroupNavProps) {
  return (
    <nav
      aria-label="Environment groups"
      className="flex gap-1 overflow-x-auto pb-1 lg:w-60 lg:shrink-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
    >
      {groups.map((group) => (
        <EnvGroupNavItem
          key={group.id}
          group={group}
          active={group.id === activeGroup}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function EnvGroupNavItem({
  group,
  active,
  onSelect,
}: {
  readonly group: EnvGroupSummary;
  readonly active: boolean;
  readonly onSelect: (groupId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      data-testid={`env-group-tab-${group.id}`}
      onClick={() => {
        onSelect(group.id);
      }}
      className={cn(
        "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-left text-[12px] transition lg:text-[13px]",
        active ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{group.label}</span>
      {group.overridden > 0 && (
        <span
          title={`${group.overridden} overridden`}
          className="hidden min-w-5 shrink-0 rounded-pill bg-accent-soft px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums text-accent lg:inline"
        >
          {group.overridden}
        </span>
      )}
      <Text
        as="span"
        size="xs"
        tone={active ? "default" : "muted"}
        className="hidden tabular-nums lg:inline"
      >
        {group.total}
      </Text>
    </button>
  );
}
