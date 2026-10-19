/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Badge, Button, Input, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import { validateBotEnvName } from "./bot-format";
import { useBotAction } from "./use-bot-action";

interface EnvEntry {
  readonly name: string;
  readonly value: string;
}

interface EnvRowProps {
  readonly entry: string;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onRemove: (target: string) => void;
}

function EnvRow(props: EnvRowProps) {
  const { entry, pending, busy, onRemove } = props;
  return (
    <li className="flex items-center justify-between gap-3 px-3.5 py-2">
      <Text size="sm" mono className="min-w-0 truncate">
        {entry}
      </Text>
      <div className="flex shrink-0 items-center gap-2">
        {pending && (
          <Badge tone="neutral" size="sm">
            Unsaved
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            onRemove(entry);
          }}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

interface EnvFormProps {
  readonly name: string;
  readonly value: string;
  readonly busy: boolean;
  readonly onNameChange: (value: string) => void;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
}

function EnvForm(props: EnvFormProps) {
  const { name, value, busy, onNameChange, onValueChange, onSubmit } = props;
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        label="Name"
        value={name}
        autoComplete="off"
        placeholder="API_KEY"
        onChange={(event) => {
          onNameChange(event.currentTarget.value);
        }}
      />
      <Input
        label="Value"
        type="password"
        value={value}
        autoComplete="new-password"
        placeholder="••••••••"
        hint="Stored encrypted. You will not see it again."
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
      />
      <div className="sm:pt-6">
        <Button type="submit" variant="secondary" disabled={busy}>
          Set variable
        </Button>
      </div>
    </form>
  );
}

interface EnvListProps {
  readonly names: readonly string[];
  readonly pending: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onRemove: (target: string) => void;
}

function EnvList(props: EnvListProps) {
  const { names, pending, busy, onRemove } = props;
  if (names.length === 0) {
    return (
      <Text size="sm" tone="muted" data-testid="bot-env-empty">
        No environment variables yet.
      </Text>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-surface-2">
      {names.map((entry) => (
        <EnvRow
          key={entry}
          entry={entry}
          pending={pending.has(entry)}
          busy={busy}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

/** Sets and removes environment variables; values are write-only. */
export function BotEnvironmentTab(props: { readonly bot: BotDetail }) {
  const { bot } = props;
  const setEnv = useMutation(api.bots.setEnv);
  const { busy, error, run } = useBotAction();
  const [setList, setSetList] = useState<readonly EnvEntry[]>([]);
  const [remove, setRemove] = useState<readonly string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const pending = new Set(setList.map((entry) => entry.name));
  const names = [
    ...new Set([
      ...bot.envNames.filter((entry) => !remove.includes(entry)),
      ...setList.map((entry) => entry.name),
    ]),
  ].sort();

  function add(): void {
    const invalid = validateBotEnvName(name);
    if (invalid !== null) {
      setFormError(invalid);
      return;
    }
    setFormError(null);
    setSetList((current) => [...current.filter((entry) => entry.name !== name), { name, value }]);
    setName("");
    setValue("");
  }

  function removeName(target: string): void {
    setSetList((current) => current.filter((entry) => entry.name !== target));
    setRemove((current) => (current.includes(target) ? current : [...current, target]));
  }

  function save(): void {
    void run(
      () => setEnv({ botId: bot.id, set: [...setList], remove: [...remove] }),
      "Could not save the environment.",
    ).then((ok) => {
      if (ok) {
        setSetList([]);
        setRemove([]);
      }
    });
  }

  const dirty = setList.length > 0 || remove.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="bot-environment">
      <Text size="sm" tone="muted">
        Values are encrypted at rest and never shown again. Removing a name only takes effect when
        you save.
      </Text>

      <EnvList names={names} pending={pending} busy={busy} onRemove={removeName} />

      <EnvForm
        name={name}
        value={value}
        busy={busy}
        onNameChange={setName}
        onValueChange={setValue}
        onSubmit={add}
      />

      {formError !== null && (
        <Text role="alert" tone="danger" size="sm">
          {formError}
        </Text>
      )}
      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}

      <div>
        <Button loading={busy} disabled={busy || !dirty} onClick={save}>
          Save environment
        </Button>
      </div>
    </div>
  );
}
