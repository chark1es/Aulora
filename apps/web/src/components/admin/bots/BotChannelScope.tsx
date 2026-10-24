/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon, SegmentedControl, Text } from "@aulora/ui-web";
import { Combobox } from "../Combobox";

export interface BotChannelChoice {
  readonly id: string;
  readonly name: string;
}

export type BotChannelMode = "all" | "selected";

const SCOPE_OPTIONS: readonly { readonly value: BotChannelMode; readonly label: string }[] = [
  { value: "all", label: "All channels the permissions reach" },
  { value: "selected", label: "Only selected channels" },
];

export interface BotChannelScopeProps {
  readonly mode: BotChannelMode;
  readonly channels: readonly BotChannelChoice[];
  readonly selected: readonly string[];
  readonly onModeChange: (mode: BotChannelMode) => void;
  readonly onSelectedChange: (ids: readonly string[]) => void;
}

/**
 * Channel scope for a bot: every channel its grants reach, or a hand-picked
 * set. Scope can only narrow what the grants allow, never widen it.
 */
export function BotChannelScope({
  mode,
  channels,
  selected,
  onModeChange,
  onSelectedChange,
}: BotChannelScopeProps) {
  const selectedSet = new Set(selected);
  const options = channels
    .filter((channel) => !selectedSet.has(channel.id))
    .map((channel) => ({ value: channel.id, label: channel.name }));
  return (
    <section className="flex flex-col gap-2">
      <Text as="h4" size="xs" tone="muted" className="font-semibold">
        Channel scope
      </Text>
      <SegmentedControl
        label="Channel scope"
        value={mode}
        options={SCOPE_OPTIONS}
        onChange={onModeChange}
      />
      {mode === "selected" && (
        <div className="flex flex-col gap-2">
          <Combobox
            aria-label="Add a channel"
            value=""
            options={options}
            placeholder="Add a channel"
            emptyMessage="No more channels."
            disabled={options.length === 0}
            onChange={(id) => {
              if (id.length > 0) {
                onSelectedChange([...selected, id]);
              }
            }}
          />
          {selected.length === 0 ? (
            <Text size="xs" tone="muted">
              No channels selected yet.
            </Text>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {selected.map((id) => {
                const channel = channels.find((entry) => entry.id === id);
                const name = channel?.name ?? id;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[12px] text-text"
                  >
                    <Icon name="hash" size={11} className="text-text-muted" />
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      onClick={() => {
                        onSelectedChange(selected.filter((entry) => entry !== id));
                      }}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
