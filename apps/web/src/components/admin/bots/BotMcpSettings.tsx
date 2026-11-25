import { Button, ConfirmDialog, cn, EmptyState, Icon, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotMcpTokenSummary } from "../../../../../../packages/convex/convex/lib/botMcpTypes";
import { AdminPageHeader } from "../AdminPageHeader";
import { BotMcpCreateDialog } from "./BotMcpCreateDialog";
import { BotMcpTokenRow } from "./BotMcpTokenRow";
import { describeMcpBots, mcpEndpoint } from "./bot-mcp-format";
import { useBotAction } from "./use-bot-action";

export interface BotMcpSettingsProps {
  /** Public origin of the workspace, or `null` while it is unknown. */
  readonly origin: string | null;
  readonly onBack: () => void;
}

/**
 * MCP access, a sub-page of Bots: the tokens that let an AI assistant manage
 * bots, with create (and one-time reveal) and revoke.
 */
export function BotMcpSettings({ origin, onBack }: BotMcpSettingsProps) {
  const tokens = useQuery(api.botMcpTokens.list, {});
  const bots = useQuery(api.bots.list, {});
  const revoke = useMutation(api.botMcpTokens.revoke);
  const { busy, error, run } = useBotAction();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<BotMcpTokenSummary | null>(null);

  const botOptions = (bots ?? []).map((bot) => ({ id: bot.id, name: bot.name }));
  const botNames = new Map(botOptions.map((bot) => [bot.id, bot.name]));

  function confirmRevoke(): void {
    const target = revoking;
    setRevoking(null);
    if (target !== null) {
      void run(() => revoke({ tokenId: target.id }), "Could not revoke the token.");
    }
  }

  const isEmpty = tokens !== undefined && tokens.length === 0;
  const addButton = (
    <Button
      leading={<Icon name="plus" size={14} />}
      disabled={origin === null}
      onClick={() => {
        setCreating(true);
      }}
    >
      New token
    </Button>
  );

  return (
    <div className={cn("flex flex-col", isEmpty ? "gap-6" : "gap-8")} data-testid="bot-mcp">
      <AdminPageHeader
        title="MCP access"
        description="Let an AI assistant such as Claude Code or Cursor manage bots, using a token with limited scope."
        back={{ label: "Bots", onClick: onBack }}
        trailing={tokens !== undefined && tokens.length > 0 ? addButton : null}
      />

      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}

      {tokens === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading tokens" />
        </div>
      ) : tokens.length === 0 ? (
        <EmptyState
          size="sm"
          title="No MCP tokens yet"
          description="MCP lets an AI assistant list, read and edit your bots. A token limits what it can do, which bots it can reach and how long it works."
          action={addButton}
        />
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {tokens.map((token) => (
            <BotMcpTokenRow
              key={token.id}
              token={token}
              botsLabel={describeMcpBots(token.botIds, botNames)}
              busy={busy}
              now={Date.now()}
              onRevoke={() => {
                setRevoking(token);
              }}
            />
          ))}
        </ul>
      )}

      {creating && origin !== null && (
        <BotMcpCreateDialog
          bots={botOptions}
          url={mcpEndpoint(origin)}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => {
          setRevoking(null);
        }}
        title={revoking === null ? "Revoke this token?" : `Revoke ${revoking.name}?`}
        description="Any AI client using it loses access right away. This cannot be undone."
        confirmLabel="Revoke token"
        variant="danger"
        icon="key"
        onConfirm={confirmRevoke}
      />
    </div>
  );
}
