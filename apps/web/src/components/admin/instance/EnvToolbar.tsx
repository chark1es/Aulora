/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon, IconButton, Text } from "@aulora/ui-web";
import { ENV_FILTERS, type EnvFilter } from "../../../lib/instance-env";

export interface EnvToolbarProps {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly filter: EnvFilter;
  readonly onFilterChange: (filter: EnvFilter) => void;
  readonly resultCount: number;
}

/** Search field plus the All / Overridden / Overridable / Read-only chips. */
export function EnvToolbar(props: EnvToolbarProps) {
  const { query, onQueryChange, filter, onFilterChange, resultCount } = props;
  return (
    <div className="flex flex-col gap-2">
      <EnvSearchField query={query} onQueryChange={onQueryChange} />
      <div className="flex flex-wrap items-center gap-1">
        {ENV_FILTERS.map((entry) => (
          <EnvFilterChip
            key={entry.id}
            label={entry.label}
            active={entry.id === filter}
            onSelect={() => {
              onFilterChange(entry.id);
            }}
          />
        ))}
        <Text size="xs" tone="muted" className="ml-auto" data-testid="env-result-count">
          {resultCount === 1 ? "1 variable" : `${resultCount} variables`}
        </Text>
      </div>
    </div>
  );
}

function EnvSearchField({
  query,
  onQueryChange,
}: {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-input border border-border bg-surface-3 px-2.5 focus-within:border-accent">
      <Icon name="search" size={15} className="text-text-muted" />
      <input
        aria-label="Filter variables"
        placeholder="Filter variables…"
        value={query}
        onChange={(event) => {
          onQueryChange(event.currentTarget.value);
        }}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-text placeholder:text-text-muted focus:outline-none"
      />
      {query.length > 0 && (
        <IconButton
          label="Clear filter"
          size="sm"
          data-testid="env-filter-clear"
          onClick={() => {
            onQueryChange("");
          }}
        >
          <Icon name="x" size={13} />
        </IconButton>
      )}
    </div>
  );
}

function EnvFilterChip({
  label,
  active,
  onSelect,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "rounded-pill border px-2.5 py-1 text-[12px] font-medium transition",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-text-muted hover:border-text-muted/40 hover:text-text",
      )}
    >
      {label}
    </button>
  );
}
