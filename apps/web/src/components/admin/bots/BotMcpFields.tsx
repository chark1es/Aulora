/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_MCP_LIMITS, BOT_MCP_SCOPES, type BotMcpScope } from "@aulora/core";
import { Checkbox, ChoiceList, type ChoiceOption, Icon, Input, Select, Text } from "@aulora/ui-web";
import {
  expiryOptionLabel,
  MCP_SCOPE_DESCRIPTIONS,
  MCP_SCOPE_LABELS,
  type McpBotAccess,
  type McpFormState,
  parseExpiryDays,
  toggleBotId,
} from "./bot-mcp-format";

const SCOPE_OPTIONS: readonly ChoiceOption<BotMcpScope>[] = BOT_MCP_SCOPES.map((scope) => ({
  value: scope,
  title: MCP_SCOPE_LABELS[scope],
  description: MCP_SCOPE_DESCRIPTIONS[scope],
  leading: <Icon name={scope === "read" ? "eye" : "pencil"} size={16} />,
}));

const ACCESS_OPTIONS: readonly ChoiceOption<McpBotAccess>[] = [
  {
    value: "all",
    title: "All bots",
    description: "Including bots created later",
    leading: <Icon name="grid" size={16} />,
  },
  {
    value: "selected",
    title: "Selected bots",
    description: "Cannot create bots",
    leading: <Icon name="checklist" size={16} />,
  },
];

const EXPIRY_OPTIONS = BOT_MCP_LIMITS.expiryDays.map((days) => ({
  value: String(days),
  label: expiryOptionLabel(days),
}));

export interface McpBotOption {
  readonly id: string;
  readonly name: string;
}

export interface BotMcpFieldsProps {
  readonly form: McpFormState;
  readonly bots: readonly McpBotOption[];
  readonly error: string | null;
  readonly onPatch: (patch: Partial<McpFormState>) => void;
}

function BotPicker(props: {
  readonly bots: readonly McpBotOption[];
  readonly selected: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
}) {
  const { bots, selected, onChange } = props;
  if (bots.length === 0) {
    return (
      <Text size="sm" tone="muted">
        There are no bots to choose from yet.
      </Text>
    );
  }
  return (
    <fieldset className="m-0 flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto rounded-[10px] border border-border bg-surface-1 p-2.5">
      <legend className="sr-only">Bots this token can reach</legend>
      {bots.map((bot) => (
        <Checkbox
          key={bot.id}
          label={bot.name}
          checked={selected.includes(bot.id)}
          onChange={(checked) => {
            onChange(toggleBotId(selected, bot.id, checked));
          }}
        />
      ))}
    </fieldset>
  );
}

function FieldLabel({ children }: { readonly children: string }) {
  return <span className="text-[12.5px] font-medium text-text">{children}</span>;
}

/** The inputs of the "New token" dialog. The caller owns the state and validation. */
export function BotMcpFields({ form, bots, error, onPatch }: BotMcpFieldsProps) {
  return (
    <div className="flex flex-col gap-5">
      <Input
        label="Name"
        value={form.name}
        maxLength={BOT_MCP_LIMITS.maxNameLength}
        autoComplete="off"
        hint="Where it is used, for example Claude Code on my laptop."
        onChange={(event) => {
          onPatch({ name: event.currentTarget.value });
        }}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Scope</FieldLabel>
        <ChoiceList
          label="Scope"
          value={form.scope}
          options={SCOPE_OPTIONS}
          onChange={(scope) => {
            onPatch({ scope });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Bot access</FieldLabel>
        <ChoiceList
          label="Bot access"
          layout="grid"
          value={form.access}
          options={ACCESS_OPTIONS}
          onChange={(access) => {
            onPatch({ access });
          }}
        />
        {form.access === "selected" && (
          <BotPicker
            bots={bots}
            selected={form.botIds}
            onChange={(botIds) => {
              onPatch({ botIds });
            }}
          />
        )}
      </div>
      <Select
        label="Expires after"
        value={String(form.expiryDays)}
        options={EXPIRY_OPTIONS}
        onChange={(value) => {
          const expiryDays = parseExpiryDays(value);
          if (expiryDays !== undefined) {
            onPatch({ expiryDays });
          }
        }}
      />
      <Text size="xs" tone="muted">
        A token never changes permissions, channel scope or bot API tokens, and cannot delete bots.
        It stops working if its creator loses Manage bots.
      </Text>
      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
