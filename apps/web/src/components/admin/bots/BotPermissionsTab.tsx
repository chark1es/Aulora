import { Button, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import { type BotChannelChoice, type BotChannelMode, BotChannelScope } from "./BotChannelScope";
import { BotBlockedPermissions, BotGrantsGrid } from "./BotGrantsGrid";
import { useBotAction } from "./use-bot-action";

const CHANNEL_PAGE = { numItems: 200, cursor: null } as const;

/** Chooses what the bot may do, and the channels that scope applies to. */
export function BotPermissionsTab({ bot }: { readonly bot: BotDetail }) {
  const channelsResult = useQuery(api.channels.list, { paginationOpts: CHANNEL_PAGE });
  const setPermissions = useMutation(api.bots.setPermissions);
  const { busy, error, run } = useBotAction();
  const [grants, setGrants] = useState<bigint>(bot.grants);
  const [mode, setMode] = useState<BotChannelMode>(
    bot.allowedChannelIds === null ? "all" : "selected",
  );
  const [selected, setSelected] = useState<readonly string[]>(() => [
    ...(bot.allowedChannelIds ?? []),
  ]);

  const channels: BotChannelChoice[] = (channelsResult?.page ?? [])
    .filter((channel) => channel.kind === "text" || channel.kind === "announcement")
    .map((channel) => ({ id: channel.id, name: channel.name ?? channel.id }));

  function save(): void {
    void run(
      () =>
        setPermissions({
          botId: bot.id,
          grants,
          allowedChannelIds: mode === "all" ? null : ([...selected] as never),
        }),
      "Could not save permissions.",
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="bot-permissions">
      {grants === 0n && (
        <Text size="sm" tone="muted" data-testid="bot-no-permissions">
          No permissions — the bot can do nothing yet.
        </Text>
      )}
      <BotGrantsGrid value={grants} disabled={busy} onChange={setGrants} />
      <BotBlockedPermissions />
      <BotChannelScope
        mode={mode}
        channels={channels}
        selected={selected}
        onModeChange={setMode}
        onSelectedChange={setSelected}
      />
      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}
      <div>
        <Button loading={busy} disabled={busy} onClick={save}>
          Save permissions
        </Button>
      </div>
    </div>
  );
}
