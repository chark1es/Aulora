import { Text } from "@aulora/ui-web";
import { useState } from "react";
import { BotDetail } from "./BotDetail";
import { BotList } from "./BotList";

export interface BotsSettingsProps {
  readonly canManageBots: boolean;
}

/**
 * The Bots surface in Settings: a list of bots with a drill-down detail view.
 * `ManageBots` gates the whole section; everyone else sees a read-only hint.
 */
export function BotsSettings({ canManageBots }: BotsSettingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!canManageBots) {
    return (
      <Text tone="muted" size="sm" data-testid="bots-locked">
        You need the Manage Bots permission to manage bots.
      </Text>
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
    />
  );
}
