import type { MessagePayload } from "@aulora/core";
import { Icon } from "@aulora/ui-web";
import type { MessageListProps } from "./MessageList";
import { revealMessage } from "./reveal-message";

function systemActorName(list: MessageListProps, actorId: string | undefined) {
  if (actorId === undefined) {
    return "Someone";
  }
  if (actorId === list.ownUserId) {
    return "You";
  }
  return list.memberNames.get(actorId) ?? "Someone";
}

export function SystemEventRow({
  list,
  message,
}: {
  readonly list: MessageListProps;
  readonly message: MessagePayload;
}) {
  const actorId = message.systemActorId;
  const targetId = message.systemTargetId;
  if (message.systemKind !== "pin" || targetId === undefined) {
    return null;
  }
  const actorName = systemActorName(list, actorId);
  return (
    <div className="flex w-full gap-2.5 py-0.5" data-testid={`system-${message.id}`}>
      <div className="flex h-5 w-8 shrink-0 items-center justify-center text-text-muted">
        <Icon name="pin" size={13} block />
      </div>
      <p className="text-[12px] leading-5 text-text-muted">
        <span className="font-medium text-text-muted">{actorName}</span> pinned a{" "}
        <button
          type="button"
          onClick={() => {
            revealMessage(targetId);
          }}
          aria-label="Jump to the pinned message"
          className="rounded-[4px] font-medium text-text-muted underline decoration-dotted underline-offset-2 transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          message
        </button>
      </p>
    </div>
  );
}
