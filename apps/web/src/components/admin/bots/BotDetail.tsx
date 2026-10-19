/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Badge, Button, Heading, Icon, IconButton, Spinner, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail as BotDetailData } from "../../../../../../packages/convex/convex/lib/botTypes";
import { BotCodeTab } from "./BotCodeTab";
import { BotEnvironmentTab } from "./BotEnvironmentTab";
import { BotLogsTab } from "./BotLogsTab";
import { BotOverviewTab } from "./BotOverviewTab";
import { BotPermissionsTab } from "./BotPermissionsTab";
import { BotStatusDot } from "./BotStatusDot";
import { BotTokenTab } from "./BotTokenTab";
import { BOT_LANGUAGE_LABELS } from "./bot-format";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "code", label: "Code" },
  { id: "permissions", label: "Permissions" },
  { id: "environment", label: "Environment" },
  { id: "logs", label: "Logs" },
  { id: "token", label: "Token" },
] as const;

type BotTab = (typeof TABS)[number]["id"];

function BotTabNav({
  tab,
  onSelect,
}: {
  readonly tab: BotTab;
  readonly onSelect: (tab: BotTab) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Bot sections">
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-current={tab === entry.id ? "page" : undefined}
          className={
            tab === entry.id
              ? "rounded-[7px] bg-surface-3 px-3 py-1 text-[13px] font-medium text-text"
              : "rounded-[7px] px-3 py-1 text-[13px] text-text-muted transition hover:bg-surface-2 hover:text-text"
          }
          onClick={() => {
            onSelect(entry.id);
          }}
        >
          {entry.label}
        </button>
      ))}
    </nav>
  );
}

function BotDetailView({
  bot,
  onBack,
}: {
  readonly bot: BotDetailData;
  readonly onBack: () => void;
}) {
  const [tab, setTab] = useState<BotTab>("overview");
  return (
    <div className="flex flex-col gap-5" data-testid="bot-detail">
      <header className="flex items-center gap-3">
        <IconButton label="Back to bots" onClick={onBack}>
          <Icon name="chevron-left" size={16} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Heading level={3} className="truncate">
              {bot.name}
            </Heading>
            <Badge tone="outline" size="sm">
              {BOT_LANGUAGE_LABELS[bot.language]}
            </Badge>
          </span>
          <BotStatusDot status={bot.status} message={bot.statusMessage} />
        </div>
      </header>
      <BotTabNav tab={tab} onSelect={setTab} />
      {tab === "overview" && <BotOverviewTab bot={bot} onBack={onBack} />}
      {tab === "code" && <BotCodeTab bot={bot} />}
      {tab === "permissions" && <BotPermissionsTab bot={bot} />}
      {tab === "environment" && <BotEnvironmentTab bot={bot} />}
      {tab === "logs" && <BotLogsTab botId={bot.id} />}
      {tab === "token" && <BotTokenTab bot={bot} />}
    </div>
  );
}

export interface BotDetailProps {
  readonly botId: string;
  readonly onBack: () => void;
}

/** Loads one bot and shows its Overview / Code / Permissions / … tabs. */
export function BotDetail({ botId, onBack }: BotDetailProps) {
  const bot = useQuery(api.bots.get, { botId: botId as never });
  if (bot === undefined) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={22} label="Loading bot" />
      </div>
    );
  }
  if (bot === null) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="bot-missing">
        <Text tone="muted">This bot no longer exists.</Text>
        <Button variant="secondary" onClick={onBack}>
          Back to bots
        </Button>
      </div>
    );
  }
  return <BotDetailView bot={bot} onBack={onBack} />;
}
