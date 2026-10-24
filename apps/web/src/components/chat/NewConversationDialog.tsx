/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, Modal } from "@aulora/ui-web";
import { useMemo, useState } from "react";
import { type PeopleOption, PeoplePicker } from "./PeoplePicker";
import { PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";

/** Group DMs hold at most ten people, the creator included (server-enforced). */
export const MAX_GROUP_DM_OTHERS = 9;

export interface NewConversationDialogProps {
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly ownUserId: string;
  readonly presenceOf: (_userId: string) => PresenceStatus;
  readonly onStart: (userIds: readonly string[]) => void;
  readonly onClose: () => void;
}

/**
 * Pick one person for a direct message, or several for a group conversation.
 */
export function NewConversationDialog({
  members,
  ownUserId,
  presenceOf,
  onStart,
  onClose,
}: NewConversationDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);

  const people = useMemo<readonly PeopleOption[]>(
    () =>
      members
        .filter((member) => member.userId !== ownUserId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((member) => ({
          id: member.userId,
          label: member.displayName,
          leading: (size: number) => (
            <PresenceAvatar
              userId={member.userId}
              size={size}
              status={presenceOf(member.userId)}
              ringClassName="ring-surface-2"
            />
          ),
        })),
    [members, ownUserId, presenceOf],
  );
  const names = new Map(people.map((person) => [person.id, person.label]));
  const full = selected.length >= MAX_GROUP_DM_OTHERS;

  const toggle = (userId: string) => {
    setSelected((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }
      return current.length >= MAX_GROUP_DM_OTHERS ? current : [...current, userId];
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      label="New message"
      title="New message"
      description={`Pick one person, or up to ${MAX_GROUP_DM_OTHERS} for a group.`}
      icon={<Icon name="compose" size={18} />}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={selected.length === 0}
            onClick={() => {
              onStart(selected);
            }}
          >
            {startLabel(selected, names)}
          </Button>
        </>
      }
    >
      <PeoplePicker
        options={people}
        selected={selected}
        onToggle={toggle}
        query={query}
        onQueryChange={setQuery}
        searchLabel="Find people"
        placeholder="Find people"
        full={full}
        autoFocus
        emptyText={
          people.length === 0
            ? "Nobody else is in this workspace yet."
            : "No one matches that name."
        }
        listClassName="max-h-[min(46vh,320px)]"
        onSearchKeyDown={(event) => {
          if (event.key === "Enter" && selected.length > 0) {
            onStart(selected);
          }
        }}
      />
    </Modal>
  );
}

/** The primary action names who the conversation is with. */
function startLabel(selected: readonly string[], names: ReadonlyMap<string, string>): string {
  const first = selected.at(0);
  if (first === undefined) {
    return "Choose someone";
  }
  if (selected.length === 1) {
    return `Message ${names.get(first) ?? "them"}`;
  }
  return `Start group with ${selected.length} people`;
}
