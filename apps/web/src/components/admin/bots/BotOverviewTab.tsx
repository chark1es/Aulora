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
    <div className="rounded-[14px] border border-border bg-surface-2 px-4 py-3">
      <Switch
        checked={bot.enabled}
        disabled={busy}
        label="Enabled"
        description="Run this bot on the runner whenever it is online."
        onChange={(enabled) => {
          void run(() => update({ botId: bot.id, enabled }), "Could not change the bot.");
        }}
      />
      <ActionError error={error} />
    </div>
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
      className="flex items-end gap-2"
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
      <Button type="submit" variant="secondary" loading={busy} disabled={busy || unchanged}>
        Save name
      </Button>
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
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-surface-2 px-4 py-3">
      <div className="min-w-0">
        <Text size="sm" className="font-medium">
          Restart
        </Text>
        <Text size="xs" tone="muted">
          Ask the runner to relaunch the bot with its current code.
        </Text>
        <ActionError error={error} />
      </div>
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
    </div>
  );
}

function BotDeleteRow({ bot, onBack }: { readonly bot: BotDetail; readonly onBack: () => void }) {
  const remove = useMutation(api.bots.remove);
  const { busy, error, run } = useBotAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-danger/30 bg-danger/5 px-4 py-3">
      <div className="min-w-0">
        <Text size="sm" className="font-medium">
          Delete bot
        </Text>
        <Text size="xs" tone="muted">
          Messages it sent stay in channels, marked as from a deleted bot.
        </Text>
        <ActionError error={error} />
      </div>
      <Button
        variant="danger"
        disabled={busy}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Delete bot
      </Button>
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
    </div>
  );
}

/** Identity and lifecycle controls for one bot. */
export function BotOverviewTab({
  bot,
  onBack,
}: {
  readonly bot: BotDetail;
  readonly onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="bot-overview">
      <BotEnableToggle bot={bot} />
      <BotNameForm bot={bot} />
      <BotDescriptionForm bot={bot} />
      <BotLanguageForm bot={bot} />
      <BotRestartRow bot={bot} />
      <BotDeleteRow bot={bot} onBack={onBack} />
    </div>
  );
}
