import type { MessagePayload } from "@aulora/core";
import { hasPermission, Permission } from "@aulora/core";
import { type ContextMenuItem, Icon } from "@aulora/ui-web";
import type { MessageListProps } from "./MessageList";

export interface MessageMenuContext {
  readonly list: MessageListProps;
  readonly message: MessagePayload;
  readonly text: string;
  readonly can: {
    readonly react: boolean;
    readonly thread: boolean;
    readonly edit: boolean;
    readonly pin: boolean;
    readonly delete: boolean;
  };
  readonly openPicker: () => void;
  readonly startEdit: () => void;
}

/** One candidate menu row: shown only when allowed, divided from the rows above it. */
interface MenuEntry {
  readonly show: boolean;
  readonly divided: boolean;
  readonly item: ContextMenuItem;
}

function primaryEntries(context: MessageMenuContext): MenuEntry[] {
  const { list, message, can, openPicker, startEdit } = context;
  const canReply =
    list.onReplyTo !== undefined && hasPermission(list.permissions, Permission.SendMessages);
  return [
    {
      show: can.react,
      divided: false,
      item: {
        id: "react",
        label: "Custom reaction",
        icon: <Icon name="smile" size={14} />,
        onSelect: openPicker,
      },
    },
    {
      show: canReply,
      divided: true,
      item: {
        id: "reply",
        label: "Reply",
        icon: <Icon name="reply" size={14} />,
        onSelect: () => list.onReplyTo?.(message),
      },
    },
    {
      show: can.thread,
      divided: true,
      item: {
        id: "thread",
        label: "Reply in thread",
        icon: <Icon name="thread" size={14} />,
        onSelect: () => {
          list.onReply(message);
        },
      },
    },
    {
      show: can.edit,
      divided: true,
      item: {
        id: "edit",
        label: "Edit message",
        icon: <Icon name="pencil" size={14} />,
        onSelect: startEdit,
      },
    },
  ];
}

function secondaryEntries(context: MessageMenuContext): MenuEntry[] {
  const { list, message, text, can } = context;
  const pinned = message.pinnedAt !== null;
  return [
    {
      show: can.pin,
      divided: false,
      item: {
        id: "pin",
        label: pinned ? "Unpin message" : "Pin message",
        icon: <Icon name={pinned ? "pin-off" : "pin"} size={14} />,
        onSelect: () => {
          list.onPinToggle(message);
        },
      },
    },
    {
      show: text.trim().length > 0,
      divided: true,
      item: {
        id: "copy",
        label: "Copy text",
        icon: <Icon name="file" size={14} />,
        onSelect: () => {
          void navigator.clipboard.writeText(text).catch(() => undefined);
        },
      },
    },
    {
      show: can.delete,
      divided: true,
      item: {
        id: "delete",
        label: "Delete message",
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onSelect: () => {
          list.onDelete(message);
        },
      },
    },
  ];
}

/** The right-click menu for a message: only the actions this viewer may take. */
export function messageMenuItems(context: MessageMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const entry of [...primaryEntries(context), ...secondaryEntries(context)]) {
    if (entry.show) {
      items.push(
        entry.divided && items.length > 0 ? { ...entry.item, separatorBefore: true } : entry.item,
      );
    }
  }
  return items;
}
