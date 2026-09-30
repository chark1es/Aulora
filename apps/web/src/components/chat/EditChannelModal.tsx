import { cn, Icon, Input, Modal, Switch } from "@aulora/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";

export interface EditChannelMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly roleColor?: string | null;
}

export interface EditChannelPatch {
  readonly name: string;
  readonly topic: string;
  readonly private: boolean;
  readonly memberIds: readonly string[];
  readonly blockedUserIds: readonly string[];
}

export interface EditChannelModalProps {
  readonly open: boolean;
  readonly channelName: string;
  readonly channelTopic: string;
  readonly isPrivate: boolean;
  readonly initialMemberIds: readonly string[];
  readonly initialBlockedUserIds: readonly string[];
  readonly ownUserId: string;
  readonly members: readonly EditChannelMemberOption[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onSave: (patch: EditChannelPatch) => void | Promise<void>;
}

/**
 * Edits an existing channel: rename, retopic, switch public/private, pick who
 * can access and block specific members. Mirrors the create-channel dialog's
 * modal grammar; reuses the channel override system for blocked users.
 */
export function EditChannelModal({
  open,
  channelName,
  channelTopic,
  isPrivate,
  initialMemberIds,
  initialBlockedUserIds,
  ownUserId,
  members,
  busy = false,
  error = null,
  onClose,
  onSave,
}: EditChannelModalProps) {
  const [name, setName] = useState(channelName);
  const [topic, setTopic] = useState(channelTopic);
  const [privateChannel, setPrivateChannel] = useState(isPrivate);
  const [selectedMembers, setSelectedMembers] = useState<readonly string[]>(initialMemberIds);
  const [blockedUserIds, setBlockedUserIds] = useState<readonly string[]>(initialBlockedUserIds);
  const [memberQuery, setMemberQuery] = useState("");
  const [blockQuery, setBlockQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the form each time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on open, not on every prop identity change
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setName(channelName);
    setTopic(channelTopic);
    setPrivateChannel(isPrivate);
    setSelectedMembers(initialMemberIds);
    setBlockedUserIds(initialBlockedUserIds);
    setMemberQuery("");
    setBlockQuery("");
    setSaving(false);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members],
  );
  const memberNeedle = memberQuery.trim().toLowerCase();
  const blockNeedle = blockQuery.trim().toLowerCase();
  const filteredMembers = useMemo(
    () => sortedMembers.filter((member) => member.displayName.toLowerCase().includes(memberNeedle)),
    [sortedMembers, memberNeedle],
  );
  const filteredBlockMembers = useMemo(
    () => sortedMembers.filter((member) => member.displayName.toLowerCase().includes(blockNeedle)),
    [sortedMembers, blockNeedle],
  );

  const toggleMember = (userId: string) => {
    if (userId === ownUserId) {
      return;
    }
    setSelectedMembers((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  };

  const toggleBlocked = (userId: string) => {
    if (userId === ownUserId) {
      return;
    }
    setBlockedUserIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  };

  const trimmedName = name.trim();
  const disabled = trimmedName.length === 0 || busy || saving;

  const submit = () => {
    if (disabled) {
      return;
    }
    setSaving(true);
    void Promise.resolve(
      onSave({
        name: trimmedName,
        topic: topic.trim(),
        private: privateChannel,
        memberIds: privateChannel ? [...new Set([ownUserId, ...selectedMembers])] : [],
        blockedUserIds: [...new Set(blockedUserIds)],
      }),
    ).finally(() => setSaving(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Edit channel"
      title="Edit channel"
      description="Rename the channel, set its topic, control access and block members."
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name={privateChannel ? "lock" : "hash"} size={17} />
        </span>
      }
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[8px] px-3 text-[13px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={submit}
            className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy || saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div data-testid="edit-channel-modal" className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            ref={inputRef}
            label="Name"
            placeholder="e.g. product-launch"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />

          <Input
            label="Topic"
            placeholder="What is this channel about?"
            value={topic}
            maxLength={160}
            onChange={(event) => setTopic(event.target.value)}
          />

          <div className="rounded-[10px] border border-border bg-surface-1 px-3.5 py-2.5">
            <Switch
              checked={privateChannel}
              onChange={setPrivateChannel}
              label="Private channel"
              description="Only people you add can see this channel or its history."
            />
          </div>

          {privateChannel && (
            <div className="animate-message-in flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-text-muted">Who can access</span>
                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                  <Icon name="lock" size={12} />
                  Private
                </span>
              </div>

              <div className="flex max-h-[92px] min-h-9 flex-wrap items-center gap-1.5 overflow-y-auto rounded-[8px] border border-border bg-surface-3 px-2 py-1.5 transition focus-within:border-accent">
                {selectedMembers.map((userId) => {
                  const member = members.find((entry) => entry.userId === userId);
                  const self = userId === ownUserId;
                  return (
                    <span
                      key={`member:${userId}`}
                      className="flex max-w-[180px] items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-[11px] font-medium text-accent"
                    >
                      {member?.roleColor !== null &&
                        member?.roleColor !== undefined &&
                        member.roleColor.length > 0 && (
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: member.roleColor }}
                          />
                        )}
                      <span className="truncate">
                        {member?.displayName ?? userId}
                        {self ? " (you)" : ""}
                      </span>
                      {!self && (
                        <button
                          type="button"
                          aria-label={`Remove ${member?.displayName ?? userId}`}
                          onClick={() => toggleMember(userId)}
                          className="shrink-0"
                        >
                          <Icon name="x" size={11} />
                        </button>
                      )}
                    </span>
                  );
                })}
                <input
                  aria-label="Search members"
                  placeholder={selectedMembers.length === 0 ? "Add people" : ""}
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  className="min-w-[8rem] flex-1 bg-transparent px-1 text-[13px] text-text placeholder:text-text-muted focus-visible:outline-none"
                />
              </div>

              <ul className="stagger flex max-h-[148px] flex-col overflow-y-auto">
                {filteredMembers.map((member) => {
                  const checked = selectedMembers.includes(member.userId);
                  const self = member.userId === ownUserId;
                  return (
                    <li key={`member:${member.userId}`}>
                      <button
                        type="button"
                        data-testid={`member-option-${member.userId}`}
                        aria-pressed={checked}
                        disabled={self}
                        onClick={() => toggleMember(member.userId)}
                        className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition hover:bg-surface-3 disabled:cursor-default disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                          {member.displayName}
                          {self ? " (you)" : ""}
                        </span>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                            checked ? "border-accent bg-accent text-on-accent" : "border-border",
                          )}
                        >
                          {checked && <Icon name="check" size={13} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <li className="px-2.5 py-4 text-center text-[12px] text-text-muted">
                    No people match that search.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-text-muted">Blocked users</span>
              <span className="flex items-center gap-1 text-[11px] text-text-muted">
                <Icon name="x" size={12} />
                Cannot view
              </span>
            </div>

            <div
              data-testid="blocked-chips"
              className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[8px] border border-border bg-surface-3 px-2 py-1.5"
            >
              {blockedUserIds.length === 0 && (
                <span className="text-[11px] text-text-muted">No one is blocked.</span>
              )}
              {blockedUserIds.map((userId) => {
                const member = members.find((entry) => entry.userId === userId);
                const label = member?.displayName ?? userId;
                return (
                  <span
                    key={`blocked:${userId}`}
                    data-testid={`blocked-chip-${userId}`}
                    className="flex max-w-[180px] items-center gap-1 rounded-full bg-danger/15 py-0.5 pl-2 pr-1 text-[11px] font-medium text-danger"
                  >
                    <span className="truncate">{label}</span>
                    <button
                      type="button"
                      aria-label={`Unblock ${label}`}
                      onClick={() => toggleBlocked(userId)}
                      className="shrink-0"
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                );
              })}
            </div>

            <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-3 px-2.5 focus-within:border-accent">
              <Icon name="search" size={14} className="text-text-muted" />
              <input
                aria-label="Search people to block"
                placeholder="Block a member…"
                value={blockQuery}
                onChange={(event) => setBlockQuery(event.target.value)}
                className="h-8 flex-1 bg-transparent text-[13px] text-text placeholder:text-text-muted focus-visible:outline-none"
              />
            </div>

            <ul className="stagger flex max-h-[148px] flex-col overflow-y-auto">
              {filteredBlockMembers.map((member) => {
                const checked = blockedUserIds.includes(member.userId);
                const self = member.userId === ownUserId;
                return (
                  <li key={`block:${member.userId}`}>
                    <button
                      type="button"
                      data-testid={`blocked-option-${member.userId}`}
                      aria-pressed={checked}
                      disabled={self}
                      onClick={() => toggleBlocked(member.userId)}
                      className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition hover:bg-surface-3 disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                        {member.displayName}
                        {self ? " (you)" : ""}
                      </span>
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                          checked ? "border-danger bg-danger text-on-accent" : "border-border",
                        )}
                      >
                        {checked && <Icon name="check" size={13} />}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filteredBlockMembers.length === 0 && (
                <li className="px-2.5 py-4 text-center text-[12px] text-text-muted">
                  No people match that search.
                </li>
              )}
            </ul>

            <p className="text-[11px] leading-snug text-text-muted">
              Blocked users cannot view or join this channel. Blocking denies the View channel
              permission on this channel only.
            </p>
          </div>

          {error !== null && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}

          <button type="button" data-primary className="hidden">
            Submit
          </button>
        </form>
      </div>
    </Modal>
  );
}
