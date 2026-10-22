/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Badge, Button, EmptyState, Icon, Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotSummary } from "../../../../../../packages/convex/convex/lib/botTypes";
import { AdminPageHeader } from "../AdminPageHeader";
import { BotCreateDialog } from "./BotCreateDialog";
import { BotRunnerBanner } from "./BotRunnerBanner";
import { BotStatusDot } from "./BotStatusDot";
import { BOT_LANGUAGE_LABELS } from "./bot-format";
import { useBotAction } from "./use-bot-action";

interface BotRowProps {
  readonly bot: BotSummary;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onToggle: (enabled: boolean) => void;
}

function BotRow({ bot, busy, onOpen, onToggle }: BotRowProps) {
  return (
    <li className="group flex min-h-[52px] items-center gap-3 px-4 py-2 transition hover:bg-surface-3/40">
      <button
        type="button"
        data-testid={`bot-row-${bot.id}`}
        onClick={onOpen}
        className="min-w-0 flex-1 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex items-center gap-2">
          <Text as="span" size="sm" className="truncate font-medium">
            {bot.name}
          </Text>
          <Badge tone="outline" size="sm">
            {BOT_LANGUAGE_LABELS[bot.language]}
          </Badge>
          {!bot.enabled && (
            <Badge tone="neutral" size="sm">
              Disabled
            </Badge>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <BotStatusDot status={bot.status} message={bot.statusMessage} />
          {bot.description !== null && bot.description.length > 0 && (
            <Text as="span" size="xs" tone="muted" className="truncate text-[12px]">
              {bot.description}
            </Text>
          )}
        </span>
      </button>
      <Switch
        bare
        checked={bot.enabled}
        disabled={busy}
        label={`Enable ${bot.name}`}
        onChange={onToggle}
      />
    </li>
  );
}

export interface BotListProps {
  readonly onOpen: (botId: string) => void;
}

/**
 * The Bots index: every bot with its language, status and enable switch, a
 * banner when the runner is offline, and the create dialog. Selecting a row
 * drills into the detail view.
 */
export function BotList({ onOpen }: BotListProps) {
  const bots = useQuery(api.bots.list, {});
  const runner = useQuery(api.bots.runnerStatus, {});
  const update = useMutation(api.bots.update);
  const { error, run } = useBotAction();
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function toggle(botId: string, enabled: boolean): void {
    setBusyId(botId);
    void run(() => update({ botId: botId as never, enabled }), "Could not change the bot.").finally(
      () => {
        setBusyId(null);
      },
    );
  }

  // The empty state carries its own "New bot"; the header only offers it once
  // there is a list to add to.
  const hasBots = bots !== undefined && bots.length > 0;
  const headerAction = hasBots ? (
    <Button
      leading={<Icon name="plus" size={14} />}
      onClick={() => {
        setCreateOpen(true);
      }}
    >
      New bot
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-8" data-testid="bots-settings">
      <AdminPageHeader
        title="Bots"
        description="Helpers that call the same Convex functions people do, with their own identity. All permissions start off."
        trailing={headerAction}
      />

      {runner !== undefined && !runner.online && <BotRunnerBanner />}

      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}

      {bots === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading bots" />
        </div>
      ) : bots.length === 0 ? (
        <EmptyState
          icon="code"
          title="No bots yet"
          description="Create a bot, write its code, then grant only the permissions it needs."
          action={
            <Button
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              New bot
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-[12px] bg-surface-2">
          {bots.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              busy={busyId === bot.id}
              onOpen={() => {
                onOpen(bot.id);
              }}
              onToggle={(enabled) => {
                toggle(bot.id, enabled);
              }}
            />
          ))}
        </ul>
      )}

      <BotCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={(botId) => {
          setCreateOpen(false);
          onOpen(botId);
        }}
      />
    </div>
  );
}
