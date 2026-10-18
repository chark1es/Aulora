import { cn, Text } from "@aulora/ui-web";
import type { BotStatus } from "../../../../../../packages/convex/convex/lib/botTypes";
import { BOT_STATUS_META } from "./bot-format";

/** A coloured dot plus its status label, with the runner's message when set. */
export function BotStatusDot({
  status,
  message,
}: {
  readonly status: BotStatus;
  readonly message?: string | null;
}) {
  const meta = BOT_STATUS_META[status];
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid={`bot-status-${status}`}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", meta.dotClass)} />
      <Text as="span" size="xs" className={cn("shrink-0 font-medium", meta.textClass)}>
        {meta.label}
      </Text>
      {message !== undefined && message !== null && message.length > 0 && (
        <Text as="span" size="xs" tone="muted" className="truncate">
          · {message}
        </Text>
      )}
    </span>
  );
}
