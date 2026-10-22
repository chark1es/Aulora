/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, DialogSection, DialogToggleRow, Icon, Input, Modal } from "@aulora/ui-web";
import { useEffect, useMemo, useState } from "react";
import type { OverrideView } from "../../lib/workspace-admin";
import { ChannelRoleOverrides } from "./ChannelRoleOverrides";
import type { ChannelRoleOption } from "./channel-role-overrides";
import { PersonAvatar } from "./member-avatars";
import { type PeopleOption, PeoplePicker } from "./PeoplePicker";

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
  readonly roleOverrides: readonly OverrideView[];
}

export interface EditChannelModalProps {
  readonly open: boolean;
  readonly channelName: string;
  readonly channelTopic: string;
  readonly isPrivate: boolean;
  readonly initialMemberIds: readonly string[];
  readonly initialBlockedUserIds: readonly string[];
  /** Roles the viewer may override on this channel, highest position first. */
  readonly roles?: readonly ChannelRoleOption[];
  /** Existing role-target overrides for the channel. */
  readonly initialRoleOverrides?: readonly OverrideView[];
  /** Shows the role permissions section when the viewer can manage roles. */
  readonly canManageRoleOverrides?: boolean;
  readonly ownUserId: string;
  readonly members: readonly EditChannelMemberOption[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onSave: (patch: EditChannelPatch) => void | Promise<void>;
}

/** Adds or removes one id, never touching the viewer's own entry. */
function toggleIn(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

/** The people in the workspace as picker rows, with the viewer marked and locked. */
function usePeopleOptions(
  members: readonly EditChannelMemberOption[],
  ownUserId: string,
): readonly PeopleOption[] {
  return useMemo(
    () =>
      [...members]
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((member) => ({
          id: member.userId,
          label: member.displayName,
          ...(member.userId === ownUserId ? { sublabel: "You", locked: true } : {}),
          leading: (size: number) => (
            <PersonAvatar userId={member.userId} size={size} roleColor={member.roleColor} />
          ),
        })),
    [members, ownUserId],
  );
}

/** The dialog's form state, reset from the channel each time it opens. */
function useEditChannelForm(props: EditChannelModalProps) {
  const [name, setName] = useState(props.channelName);
  const [topic, setTopic] = useState(props.channelTopic);
  const [privateChannel, setPrivateChannel] = useState(props.isPrivate);
  const [selectedMembers, setSelectedMembers] = useState(props.initialMemberIds);
  const [blockedUserIds, setBlockedUserIds] = useState(props.initialBlockedUserIds);
  const [roleOverrides, setRoleOverrides] = useState(props.initialRoleOverrides ?? []);
  const [memberQuery, setMemberQuery] = useState("");
  const [blockQuery, setBlockQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on open, not on every prop identity change
  useEffect(() => {
    if (!props.open) {
      return;
    }
    setName(props.channelName);
    setTopic(props.channelTopic);
    setPrivateChannel(props.isPrivate);
    setSelectedMembers(props.initialMemberIds);
    setBlockedUserIds(props.initialBlockedUserIds);
    setRoleOverrides(props.initialRoleOverrides ?? []);
    setMemberQuery("");
    setBlockQuery("");
    setSaving(false);
  }, [props.open]);

  return {
    name,
    setName,
    topic,
    setTopic,
    privateChannel,
    setPrivateChannel,
    selectedMembers,
    toggleMember: (id: string) => {
      setSelectedMembers((current) => toggleIn(current, id));
    },
    blockedUserIds,
    toggleBlocked: (id: string) => {
      setBlockedUserIds((current) => toggleIn(current, id));
    },
    roleOverrides,
    setRoleOverrides,
    memberQuery,
    setMemberQuery,
    blockQuery,
    setBlockQuery,
    saving,
    setSaving,
  };
}

type EditChannelForm = ReturnType<typeof useEditChannelForm>;

interface SectionProps {
  readonly form: EditChannelForm;
  readonly people: readonly PeopleOption[];
  readonly ownUserId: string;
}

/** Public or private, and when private, exactly who is in. */
function AccessSection({ form, people, ownUserId }: SectionProps) {
  // The viewer always keeps access to a channel they make private (the save
  // adds them), so the list shows them as included rather than unticked.
  const withAccess = [...new Set([ownUserId, ...form.selectedMembers])];
  const count = withAccess.length;
  return (
    <DialogSection title="Access">
      <DialogToggleRow
        icon="lock"
        title="Private channel"
        description="Only the people you add can see it and its history"
        checked={form.privateChannel}
        onChange={form.setPrivateChannel}
      />
      {form.privateChannel && (
        <div className="animate-fade-in flex flex-col gap-2 pl-11">
          <span className="text-[12px] text-text-muted">
            {count === 1 ? "1 person has access" : `${count} people have access`}
          </span>
          <PeoplePicker
            options={people}
            selected={withAccess}
            onToggle={form.toggleMember}
            query={form.memberQuery}
            onQueryChange={form.setMemberQuery}
            searchLabel="Search members"
            placeholder="Add people"
            emptyText="No people match that search."
            rowTestId={(id) => `member-option-${id}`}
            listClassName="max-h-[196px]"
          />
        </div>
      )}
    </DialogSection>
  );
}

/** Members denied this channel only, whatever their roles allow elsewhere. */
function BlockedSection({ form, people }: SectionProps) {
  const count = form.blockedUserIds.length;
  return (
    <DialogSection
      title="Blocked members"
      hint="They cannot see or join this channel. Nothing changes for them elsewhere."
      trailing={count > 0 ? `${count} blocked` : undefined}
    >
      <PeoplePicker
        options={people}
        selected={form.blockedUserIds}
        onToggle={form.toggleBlocked}
        query={form.blockQuery}
        onQueryChange={form.setBlockQuery}
        searchLabel="Search people to block"
        placeholder="Find someone to block"
        tone="danger"
        chipVerb="Unblock"
        chipTestId={(id) => `blocked-chip-${id}`}
        rowTestId={(id) => `blocked-option-${id}`}
        emptyText="No people match that search."
        listClassName="max-h-[196px]"
      />
    </DialogSection>
  );
}

/** Name and topic, the two things people change most. */
function DetailsSection({ form }: { readonly form: EditChannelForm }) {
  return (
    <DialogSection title="Details">
      <Input
        label="Name"
        placeholder="e.g. product-launch"
        value={form.name}
        maxLength={80}
        leading={<Icon name="hash" size={15} />}
        onChange={(event) => {
          form.setName(event.target.value);
        }}
      />
      <Input
        label="Topic"
        placeholder="What is this channel about?"
        value={form.topic}
        maxLength={160}
        onChange={(event) => {
          form.setTopic(event.target.value);
        }}
      />
    </DialogSection>
  );
}

interface EditChannelFooterProps {
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

/** Cancel and save, with save held while the name is empty or a save is running. */
function EditChannelFooter(props: EditChannelFooterProps) {
  return (
    <>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={props.disabled}
        loading={props.loading}
        onClick={props.onSave}
      >
        Save changes
      </Button>
    </>
  );
}

/**
 * Edits an existing channel: rename, retopic, switch public/private, pick who
 * can access and block specific members. One sheet of titled sections (no
 * boxes inside the dialog), sharing the people picker with the other dialogs;
 * blocked users reuse the channel override system.
 */
export function EditChannelModal(props: EditChannelModalProps) {
  const { open, ownUserId, busy = false, error = null, onClose, onSave } = props;
  const form = useEditChannelForm(props);
  const people = usePeopleOptions(props.members, ownUserId);
  const trimmedName = form.name.trim();
  const disabled = trimmedName.length === 0 || busy || form.saving;

  const submit = () => {
    if (disabled) {
      return;
    }
    form.setSaving(true);
    void Promise.resolve(
      onSave({
        name: trimmedName,
        topic: form.topic.trim(),
        private: form.privateChannel,
        memberIds: form.privateChannel ? [...new Set([ownUserId, ...form.selectedMembers])] : [],
        blockedUserIds: [...new Set(form.blockedUserIds)],
        roleOverrides: [...form.roleOverrides],
      }),
    ).finally(() => {
      form.setSaving(false);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Edit channel"
      title={`Edit #${props.channelName}`}
      icon={<Icon name={form.privateChannel ? "lock" : "hash"} size={18} />}
      size="lg"
      footer={
        <EditChannelFooter
          disabled={disabled}
          loading={busy || form.saving}
          onCancel={onClose}
          onSave={submit}
        />
      }
    >
      <form
        data-testid="edit-channel-modal"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DetailsSection form={form} />
        <AccessSection form={form} people={people} ownUserId={ownUserId} />
        <BlockedSection form={form} people={people} ownUserId={ownUserId} />
        {props.canManageRoleOverrides === true && (
          <ChannelRoleOverrides
            roles={props.roles ?? []}
            overrides={form.roleOverrides}
            disabled={busy || form.saving}
            onChange={form.setRoleOverrides}
          />
        )}
        {error !== null && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
