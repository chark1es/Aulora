import { Icon, Text } from "@aulora/ui-web";
import { BOT_RUNNER_OFFLINE_MESSAGE } from "./bot-format";

/** Explains how to start the bot runner when its heartbeat has gone quiet. */
export function BotRunnerBanner() {
  return (
    <div
      role="status"
      data-testid="bot-runner-offline"
      className="flex items-start gap-2 rounded-[12px] border border-danger/30 bg-danger/10 px-3.5 py-2.5"
    >
      <Icon name="bell" size={15} className="mt-0.5 shrink-0 text-danger" />
      <Text size="sm">{BOT_RUNNER_OFFLINE_MESSAGE}</Text>
    </div>
  );
}
