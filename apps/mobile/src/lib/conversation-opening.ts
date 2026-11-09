import { type ChannelSummary, dmPartnerId } from "@aulora/core";
import { presenceLabel } from "./presence";

/**
 * Inputs needed to open a direct or group conversation. Kept as plain data so
 * the copy rules are unit-testable without a React Native renderer.
 */
export interface ConversationOpeningInput {
  readonly channel: Pick<ChannelSummary, "kind" | "memberIds">;
  readonly title: string;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  /** The other participant's presence for a one-to-one conversation. */
  readonly partnerStatus?: string | undefined;
  readonly canSend: boolean;
  readonly canStartCall: boolean;
}

export interface ConversationOpeningModel {
  readonly isGroup: boolean;
  readonly isSelf: boolean;
  /** The other participant in a one-to-one conversation. */
  readonly partnerId: string | undefined;
  /** Everyone except the viewer, in channel order. */
  readonly otherIds: readonly string[];
  readonly meta: string;
  readonly body: string;
  /** Pre-filled first message, or `null` when sending is not allowed. */
  readonly sayHi: string | null;
  readonly showActions: boolean;
}

/** Just the given name's first word, for the "Hey Alex 👋" suggestion. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function partnerFirstName(input: ConversationOpeningInput): string | undefined {
  const partnerId = dmPartnerId(input.channel, input.ownUserId);
  const name = partnerId === undefined ? undefined : input.memberNames.get(partnerId);
  return name !== undefined && name.trim().length > 0 ? firstNameOf(name) : undefined;
}

/**
 * The opening of a direct, group or notes-to-self conversation: who is here,
 * how they relate to the viewer, and the first thing either side can do.
 */
export function conversationOpening(input: ConversationOpeningInput): ConversationOpeningModel {
  const isGroup = input.channel.kind === "group_dm";
  const others = (input.channel.memberIds ?? []).filter((id) => id !== input.ownUserId);
  const partnerId = isGroup ? undefined : dmPartnerId(input.channel, input.ownUserId);
  const isSelf = !isGroup && partnerId === undefined && (input.channel.memberIds ?? []).length > 0;
  const firstName = isGroup ? undefined : partnerFirstName(input);

  const meta = isGroup
    ? `${others.length + 1} ${others.length === 0 ? "person" : "people"} in this conversation`
    : isSelf
      ? "Just you"
      : `${presenceLabel(input.partnerStatus ?? "offline")} · Direct message`;

  const body = isSelf
    ? "A place for notes, links, and reminders to yourself."
    : isGroup
      ? input.canSend
        ? "The first message is yours. Everyone here will see it."
        : "This is the beginning of your group conversation."
      : input.canSend
        ? "The first message is yours."
        : `This is the beginning of your conversation${firstName !== undefined ? ` with ${firstName}` : ""}.`;

  const sayHi = isGroup
    ? "Hey everyone 👋"
    : firstName !== undefined
      ? `Hey ${firstName} 👋`
      : "Hey 👋";

  return {
    isGroup,
    isSelf,
    partnerId,
    otherIds: others,
    meta,
    body,
    sayHi: input.canSend && !isSelf ? sayHi : null,
    showActions: !isSelf && (input.canSend || input.canStartCall),
  };
}
