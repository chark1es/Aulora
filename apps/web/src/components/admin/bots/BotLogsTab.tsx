import { BOT_LIMITS } from "@aulora/core";
import { EmptyState, Spinner, Text, type TextTone } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotLogLine } from "../../../../../../packages/convex/convex/lib/botTypes";

const STREAM_TONES: Readonly<Record<BotLogLine["stream"], TextTone>> = {
  stdout: "default",
  stderr: "danger",
  system: "muted",
};

/** The bot's recent output, newest last, refreshed reactively. */
export function BotLogsTab({ botId }: { readonly botId: string }) {
  const lines = useQuery(api.bots.logs, {
    botId: botId as never,
    limit: BOT_LIMITS.maxLogLines,
  });

  if (lines === undefined) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={22} label="Loading logs" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div data-testid="bot-logs">
        <EmptyState
          size="sm"
          icon="message"
          title="No output yet"
          description="Log lines appear here while the bot runs."
        />
      </div>
    );
  }

  return (
    <div
      className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-border bg-surface-1 p-3"
      data-testid="bot-logs"
      role="log"
      aria-label="Bot logs"
    >
      {lines.map((line) => (
        <Text
          as="p"
          key={`${line.at}:${line.stream}:${line.text}`}
          size="xs"
          mono
          tone={STREAM_TONES[line.stream]}
          className="whitespace-pre-wrap break-words"
          data-testid="bot-log-line"
        >
          {line.text}
        </Text>
      ))}
    </div>
  );
}
