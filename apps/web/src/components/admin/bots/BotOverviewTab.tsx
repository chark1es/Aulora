/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS, type BotLanguage } from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  Input,
  Select,
  type SelectOption,
  Switch,
  Text,
  Textarea,
} from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import { SettingsGroup, SettingsGroupRow } from "../SettingsGroup";
import { validateBotDescription, validateBotName } from "./bot-format";
import { useBotAction } from "./use-bot-action";

const LANGUAGE_OPTIONS: readonly SelectOption<BotLanguage>[] = [
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
];

function ActionError({ error }: { readonly error: string | null }) {
  if (error === null) {
    return null;
  }
  return (
    <Text role="alert" tone="danger" size="sm" className="mt-2">
      {error}
    </Text>
  );
}

/** Turns the bot on or off; a disabled bot is stopped and loses its credential. */
function BotEnableToggle({ bot }: { readonly bot: BotDetail }) {
  const update = useMutation(api.bots.update);
  const { busy, error, run } = useBotAction();
  return (
    <SettingsGroupRow
      label="Enabled"
      description="Run this bot on the runner whenever it is online."
    >
      <Switch
        bare
        checked={bot.enabled}
        disabled={busy}
        label="Enabled"
        onChange={(enabled) => {
          void run(() => update({ botId: bot.id, enabled }), "Could not change the bot.");
        }}
      />
      <ActionError error={error} />
    </SettingsGroupRow>
  );
}

function BotNameForm({ bot }: { readonly bot: BotDetail }) {
  const update = useMutation(api.bots.update);
  const { busy, error, run } = useBotAction();
  const [name, setName] = useState(bot.name);
  const invalid = validateBotName(name);
  const unchanged = name.trim() === bot.name;
  const errorProp = invalid !== null ? { error: invalid } : {};
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid !== null || unchanged) {
          return;
        }
        void run(() => update({ botId: bot.id, name: name.trim() }), "Could not rename the bot.");
      }}
    >
      <Input
        label="Name"
        value={name}
        maxLength={BOT_LIMITS.maxNameLength}
        {...errorProp}
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
      />
      <div>
        <Button
          type="submit"
          variant="secondary"
          className="whitespace-nowrap"
          loading={busy}
          disabled={busy || unchanged}
        >
          Save name
        </Button>
      </div>
      <ActionError error={error} />
    </form>
  );
}

interface BotDescriptionActionsProps {
  readonly busy: boolean;
  readonly unchanged: boolean;
}

function BotDescriptionActions(props: BotDescriptionActionsProps) {
  const { busy, unchanged } = props;
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" variant="secondary" loading={busy} disabled={busy || unchanged}>
        Save description
      </Button>
    </div>
  );
}

interface BotDescriptionFieldsProps {
  readonly description: string;
  readonly busy: boolean;
  readonly unchanged: boolean;
  readonly error: string | null;
  readonly invalid: string | null;
  readonly onDescriptionChange: (value: string) => void;
  readonly onSubmit: () => void;
}

function BotDescriptionFields(props: BotDescriptionFieldsProps) {
  const { description, busy, unchanged, error, invalid, onDescriptionChange, onSubmit } = props;
  const errorProp = invalid !== null ? { error: invalid } : {};
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Textarea
        label="Description"
        value={description}
        rows={2}
        maxLength={BOT_LIMITS.maxDescriptionLength}
        {...errorProp}
        onChange={(event) => {
          onDescriptionChange(event.currentTarget.value);
        }}
      />
      <BotDescriptionActions busy={busy} unchanged={unchanged} />
      <ActionError error={error} />
    </form>
  );
}

function BotDescriptionForm(props: { readonly bot: BotDetail }) {
  const { bot } = props;
  const update = useMutation(api.bots.update);
  const { busy, error, run } = useBotAction();
  const [description, setDescription] = useState(bot.description ?? "");
  const invalid = validateBotDescription(description);
  const trimmed = description.trim();
  const unchanged = trimmed === (bot.description ?? "");

  function submit(): void {
    if (invalid !== null || unchanged) {
      return;
    }
    void run(
      () => update({ botId: bot.id, description: trimmed.length > 0 ? trimmed : null }),
      "Could not save the description.",
    );
  }

  return (
    <BotDescriptionFields
      description={description}
      busy={busy}
      unchanged={unchanged}
      error={error}
      invalid={invalid}
      onDescriptionChange={setDescription}
      onSubmit={submit}
    />
  );
}

function BotLanguageForm({ bot }: { readonly bot: BotDetail }) {
  const update = useMutation(api.bots.update);
  const { error, run } = useBotAction();
  return (
    <div>
      <Select
        label="Language"
        value={bot.language}
        options={LANGUAGE_OPTIONS}
        onChange={(language) => {
          void run(() => update({ botId: bot.id, language }), "Could not change the language.");
        }}
      />
      <ActionError error={error} />
    </div>
  );
}

function BotRestartRow({ bot }: { readonly bot: BotDetail }) {
  const restart = useMutation(api.bots.restart);
  const { busy, error, run } = useBotAction();
  return (
    <SettingsGroupRow
      label="Restart"
      description="Ask the runner to relaunch the bot with its current code."
      align="start"
    >
      <Button
        variant="secondary"
        loading={busy}
        disabled={busy}
        onClick={() => {
          void run(() => restart({ botId: bot.id }), "Could not restart the bot.");
        }}
      >
        Restart
      </Button>
      <ActionError error={error} />
    </SettingsGroupRow>
  );
}

interface BotRowProps {
  readonly bot: BotDetail;
  readonly onBack: () => void;
}

function BotDeleteRow(props: BotRowProps) {
  const { bot, onBack } = props;
  const remove = useMutation(api.bots.remove);
  const { busy, error, run } = useBotAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsGroupRow
        label="Delete bot"
        description="Messages it sent stay in channels, marked as from a deleted bot."
        align="start"
        className="bg-danger/5"
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete bot
        </Button>
        <ActionError error={error} />
      </SettingsGroupRow>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Delete this bot?"
        description="The bot stops running and its code, permissions and token are removed. Messages it already sent stay in channels, marked as from a deleted bot."
        confirmLabel="Delete bot"
        variant="danger"
        onConfirm={() => {
          setConfirming(false);
          void run(() => remove({ botId: bot.id }), "Could not delete the bot.").then((ok) => {
            if (ok) {
              onBack();
            }
          });
        }}
      />
    </>
  );
}

/** Identity and lifecycle controls for one bot. */
export function BotOverviewTab(props: BotRowProps) {
  const { bot, onBack } = props;
  return (
    <div className="flex flex-col gap-8" data-testid="bot-overview">
      <SettingsGroup title="Identity">
        <BotEnableToggle bot={bot} />
        <div className="flex flex-col gap-4 px-4 py-3.5">
          <BotNameForm bot={bot} />
          <BotDescriptionForm bot={bot} />
          <BotLanguageForm bot={bot} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Lifecycle">
        <BotRestartRow bot={bot} />
        <BotDeleteRow bot={bot} onBack={onBack} />
      </SettingsGroup>
    </div>
  );
}
