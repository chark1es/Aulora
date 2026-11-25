import { Text } from "@aulora/ui-web";
import { useState } from "react";
import { BotDetail } from "./BotDetail";
import { BotList } from "./BotList";
import { BotMcpSettings } from "./BotMcpSettings";

export interface BotsSettingsProps {
  readonly canManageBots: boolean;
  /** Public workspace origin, or `null` until the client knows it. */
  readonly origin: string | null;
}

/**
 * The Bots surface in Settings: a list of bots with a drill-down detail view.
 * `ManageBots` gates the whole section, including MCP access; everyone else sees
 * a read-only hint.
 */
export function BotsSettings({ canManageBots, origin }: BotsSettingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);

  if (!canManageBots) {
    return (
      <Text tone="muted" size="sm" data-testid="bots-locked">
        You need the Manage Bots permission to manage bots.
      </Text>
    );
  }

  if (mcpOpen) {
    return (
      <BotMcpSettings
        origin={origin}
        onBack={() => {
          setMcpOpen(false);
        }}
      />
    );
  }

  if (selectedId !== null) {
    return (
      <BotDetail
        key={selectedId}
        botId={selectedId}
        onBack={() => {
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <BotList
      onOpen={(botId) => {
        setSelectedId(botId);
      }}
      onOpenMcp={() => {
        setMcpOpen(true);
      }}
    />
  );
}
