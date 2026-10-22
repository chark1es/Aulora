/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, DialogToggleRow, Icon, Input, Modal } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import { type ChannelKind, CreateChannelKindPicker } from "./CreateChannelKindPicker";
import {
  type CreateChannelMemberOption,
  CreateChannelMemberPicker,
  type CreateChannelRoleOption,
} from "./CreateChannelMemberPicker";

export type {
  CreateChannelMemberOption,
  CreateChannelRoleOption,
} from "./CreateChannelMemberPicker";

export interface CreateChannelInput {
  readonly name: string;
  readonly kind: ChannelKind;
  readonly private: boolean;
  readonly categoryId?: string;
  /** Private channels only: explicit members granted read + write access. */
  readonly memberIds?: readonly string[];
  /** Private channels only: roles whose members are granted read + write access. */
  readonly roleIds?: readonly string[];
}

export interface CreateChannelModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CreateChannelInput) => void | Promise<void>;
  readonly initialCategoryId?: string;
  readonly initialKind?: ChannelKind;
  /** Workspace members offered by the private whitelist picker. */
  readonly members?: readonly CreateChannelMemberOption[];
  /** Roles offered by the private whitelist picker. */
  readonly roles?: readonly CreateChannelRoleOption[];
}

const EMPTY_MEMBERS: readonly CreateChannelMemberOption[] = [];
const EMPTY_ROLES: readonly CreateChannelRoleOption[] = [];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function toggle(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

/** The glyph for a channel kind, used in the picker and the name field. */
function kindIcon(kind: ChannelKind): "announce" | "volume" | "hash" {
  if (kind === "announcement") {
    return "announce";
  }
  return kind === "voice" ? "volume" : "hash";
}

/** The glyph beside the dialog title: the kind, or a lock for a private channel. */
function headerIcon(
  kind: ChannelKind,
  isPrivate: boolean,
): "announce" | "volume" | "lock" | "hash" {
  return isPrivate ? "lock" : kindIcon(kind);
}

/** The dialog body: name, type rows, privacy and (when private) the whitelist. */
function CreateChannelForm(props: {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly kind: ChannelKind;
  readonly onKindChange: (kind: ChannelKind) => void;
  readonly isPrivate: boolean;
  readonly onPrivateChange: (isPrivate: boolean) => void;
  readonly members: readonly CreateChannelMemberOption[];
  readonly roles: readonly CreateChannelRoleOption[];
  readonly selectedRoles: readonly string[];
  readonly selectedMembers: readonly string[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onToggleRole: (id: string) => void;
  readonly onToggleMember: (userId: string) => void;
}) {
  const slug = slugify(props.name);

  return (
    <div className="flex flex-col gap-5">
      <Input
        label="Channel name"
        placeholder="e.g. product-launch"
        value={props.name}
        maxLength={80}
        leading={<Icon name={kindIcon(props.kind)} size={15} />}
        onChange={(event) => {
          props.onNameChange(event.target.value);
        }}
        {...(slug.length > 0 && slug !== props.name.trim()
          ? { hint: `Will be created as #${slug}` }
          : {})}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-text">Type</span>
        <CreateChannelKindPicker value={props.kind} onChange={props.onKindChange} />
      </div>

      <div className="border-t border-border/60 pt-4">
        <DialogToggleRow
          icon="lock"
          title="Private channel"
          description="Only the roles and members you choose can see it"
          checked={props.isPrivate}
          onChange={props.onPrivateChange}
        />
      </div>

      {props.isPrivate && (
        <CreateChannelMemberPicker
          roles={props.roles}
          members={props.members}
          selectedRoles={props.selectedRoles}
          selectedMembers={props.selectedMembers}
          query={props.query}
          onQueryChange={props.onQueryChange}
          onToggleRole={props.onToggleRole}
          onToggleMember={props.onToggleMember}
        />
      )}
    </div>
  );
}

/**
 * The create-channel dialog. A focused modal instead of an inline form, so
 * opening it never reflows the channel list underneath. The name comes first
 * (it takes focus), then the type, then privacy; a private channel additionally reveals a
 * searchable role/member whitelist.
 */
export function CreateChannelModal({
  open,
  onClose,
  onCreate,
  initialCategoryId,
  initialKind = "text",
  members = EMPTY_MEMBERS,
  roles = EMPTY_ROLES,
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>(initialKind);
  const [isPrivate, setIsPrivate] = useState(false);
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategoryId);
  const [selectedMembers, setSelectedMembers] = useState<readonly string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setKind(initialKind);
      setIsPrivate(false);
      setCategoryId(initialCategoryId);
      setSelectedMembers([]);
      setSelectedRoles([]);
      setQuery("");
      setBusy(false);
    }
  }, [open, initialCategoryId, initialKind]);

  const slug = slugify(name);
  const canSubmit = slug.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    void Promise.resolve(
      onCreate({
        name: slug,
        kind,
        private: isPrivate,
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(isPrivate && selectedMembers.length > 0 ? { memberIds: selectedMembers } : {}),
        ...(isPrivate && selectedRoles.length > 0 ? { roleIds: selectedRoles } : {}),
      }),
    ).finally(() => {
      setBusy(false);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Create a channel"
      title="Create a channel"
      icon={<Icon name={headerIcon(kind, isPrivate)} size={18} />}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} loading={busy} onClick={submit}>
            {busy ? "Creating…" : "Create channel"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <CreateChannelForm
          name={name}
          onNameChange={setName}
          kind={kind}
          onKindChange={setKind}
          isPrivate={isPrivate}
          onPrivateChange={setIsPrivate}
          members={members}
          roles={roles}
          selectedRoles={selectedRoles}
          selectedMembers={selectedMembers}
          query={query}
          onQueryChange={setQuery}
          onToggleRole={(id) => {
            setSelectedRoles((current) => toggle(current, id));
          }}
          onToggleMember={(userId) => {
            setSelectedMembers((current) => toggle(current, userId));
          }}
        />
      </form>
    </Modal>
  );
}
