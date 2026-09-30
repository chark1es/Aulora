import { cn, Icon, Modal } from "@aulora/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";

/** Group DMs hold at most ten people, the creator included (server-enforced). */
export const MAX_GROUP_DM_OTHERS = 9;

export interface NewConversationDialogProps {
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly ownUserId: string;
  readonly presenceOf: (userId: string) => PresenceStatus;
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const others = useMemo(
    () =>
      members
        .filter((member) => member.userId !== ownUserId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members, ownUserId],
  );
  const visible = others.filter((member) =>
    member.displayName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const names = new Map(others.map((member) => [member.userId, member.displayName]));
  const full = selected.length >= MAX_GROUP_DM_OTHERS;

  const toggle = (userId: string) =>
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= MAX_GROUP_DM_OTHERS
          ? current
          : [...current, userId],
    );

  const cta =
    selected.length === 0
      ? "Choose someone"
      : selected.length === 1
        ? `Message ${names.get(selected[0] ?? "") ?? "them"}`
        : `Start group with ${selected.length} people`;

  return (
    <Modal
      open
      onClose={onClose}
      label="New message"
      title="New message"
      description={`Pick one person, or up to ${MAX_GROUP_DM_OTHERS} for a group.`}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name="compose" size={17} />
        </span>
      }
      footer={
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onStart(selected)}
          className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:bg-surface-3 disabled:text-text-muted"
        >
          {cta}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* The chip row scrolls internally so a long selection never grows the dialog. */}
        <div className="flex max-h-[84px] min-h-10 flex-wrap items-center gap-1.5 overflow-y-auto rounded-[8px] border border-border bg-surface-3 px-2 py-1.5 focus-within:border-accent">
          {selected.map((userId) => (
            <button
              key={userId}
              type="button"
              aria-label={`Remove ${names.get(userId) ?? "member"}`}
              onClick={() => toggle(userId)}
              className="flex max-w-[180px] items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-xs font-medium text-accent"
            >
              <span className="truncate">{names.get(userId)}</span>
              <Icon name="x" size={12} className="shrink-0" />
            </button>
          ))}
          <input
            ref={inputRef}
            aria-label="Find people"
            placeholder={selected.length === 0 ? "Find people" : ""}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
              }
              if (event.key === "Backspace" && query.length === 0 && selected.length > 0) {
                setSelected((current) => current.slice(0, -1));
              }
              if (event.key === "Enter" && selected.length > 0) {
                onStart(selected);
              }
            }}
            className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          />
        </div>

        <ul className="stagger flex max-h-[min(46vh,320px)] flex-col overflow-y-auto">
          {visible.map((member) => {
            const checked = selected.includes(member.userId);
            return (
              <li key={member.userId}>
                <button
                  type="button"
                  aria-pressed={checked}
                  disabled={!checked && full}
                  onClick={() => toggle(member.userId)}
                  className="flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-surface-3 disabled:opacity-40"
                >
                  <PresenceAvatar
                    userId={member.userId}
                    size={34}
                    status={presenceOf(member.userId)}
                    ringClassName="ring-surface-2"
                  />
                  <span className="flex-1 truncate text-sm font-medium text-text">
                    {member.displayName}
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border transition",
                      checked ? "border-accent bg-accent text-on-accent" : "border-border",
                    )}
                  >
                    {checked && <Icon name="check" size={13} />}
                  </span>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-text-muted">
              {others.length === 0
                ? "Nobody else is in this workspace yet."
                : "No one matches that name."}
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
