import { cn, Icon, Input, Modal, Switch } from "@aulora/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";

export interface CreateChannelInput {
  readonly name: string;
  readonly kind: "text" | "announcement" | "voice";
  readonly private: boolean;
  readonly categoryId?: string;
  /** Private channels only: explicit members granted read + write access. */
  readonly memberIds?: readonly string[];
  /** Private channels only: roles whose members are granted read + write access. */
  readonly roleIds?: readonly string[];
}

export interface CreateChannelMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly roleColor?: string | null;
}

export interface CreateChannelRoleOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
}

export interface CreateChannelModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CreateChannelInput) => void | Promise<void>;
  readonly initialCategoryId?: string;
  /** Workspace members offered by the private whitelist picker. */
  readonly members?: readonly CreateChannelMemberOption[];
  /** Roles offered by the private whitelist picker. */
  readonly roles?: readonly CreateChannelRoleOption[];
}

type Kind = "text" | "announcement" | "voice";

const EMPTY_MEMBERS: readonly CreateChannelMemberOption[] = [];
const EMPTY_ROLES: readonly CreateChannelRoleOption[] = [];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * The create-channel dialog. A focused modal instead of an inline form, so
 * opening it never reflows the channel list underneath. Mirrors the app's
 * modal grammar: title, single short task, primary action, Cancel. A private
 * channel additionally reveals a searchable role/member whitelist.
 */
export function CreateChannelModal({
  open,
  onClose,
  onCreate,
  initialCategoryId,
  members = EMPTY_MEMBERS,
  roles = EMPTY_ROLES,
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("text");
  const [isPrivate, setIsPrivate] = useState(false);
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategoryId);
  const [selectedMembers, setSelectedMembers] = useState<readonly string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setKind("text");
      setIsPrivate(false);
      setCategoryId(initialCategoryId);
      setSelectedMembers([]);
      setSelectedRoles([]);
      setQuery("");
      setBusy(false);
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, initialCategoryId]);

  const slug = slugify(name);
  const canSubmit = slug.length > 0 && !busy;

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members],
  );

  const needle = query.trim().toLowerCase();
  const filteredRoles = useMemo(
    () => roles.filter((role) => role.name.toLowerCase().includes(needle)),
    [roles, needle],
  );
  const filteredMembers = useMemo(
    () => sortedMembers.filter((member) => member.displayName.toLowerCase().includes(needle)),
    [sortedMembers, needle],
  );

  const toggleRole = (id: string) =>
    setSelectedRoles((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const toggleMember = (userId: string) =>
    setSelectedMembers((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );

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
    ).finally(() => setBusy(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Create a channel"
      title="Create a channel"
      description={
        kind === "announcement"
          ? "Anyone with access can read; only some roles can post."
          : kind === "voice"
            ? "Drop in for voice and video calls with everyone here."
            : "In a text channel, everyone with access can talk."
      }
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon
            name={
              kind === "announcement"
                ? "announce"
                : kind === "voice"
                  ? "volume"
                  : isPrivate
                    ? "lock"
                    : "hash"
            }
            size={18}
          />
        </span>
      }
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
            disabled={!canSubmit}
            onClick={submit}
            className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create channel"}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          ref={inputRef}
          label="Channel name"
          placeholder="e.g. product-launch"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          {...(slug.length > 0 && slug !== name.trim()
            ? { hint: `Will be created as #${slug}` }
            : {})}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-muted">Channel type</span>
          <fieldset aria-label="Channel type" className="grid grid-cols-2 gap-2">
            <KindOption
              active={kind === "text"}
              icon={<Icon name="hash" size={17} />}
              title="Text"
              description="Messages, threads and files"
              onClick={() => setKind("text")}
            />
            <KindOption
              active={kind === "announcement"}
              icon={<Icon name="announce" size={17} />}
              title="Announcements"
              description="Read-only for most members"
              onClick={() => setKind("announcement")}
            />
            <KindOption
              active={kind === "voice"}
              icon={<Icon name="volume" size={17} />}
              title="Voice"
              description="Voice and video calls"
              onClick={() => setKind("voice")}
            />
          </fieldset>
        </div>

        <div className="rounded-[10px] border border-border bg-surface-1 px-3.5 py-2.5">
          <Switch
            checked={isPrivate}
            onChange={setIsPrivate}
            label="Make private"
            description="Only people you add can see this channel or its history."
          />
        </div>

        {isPrivate && (
          <div className="animate-message-in flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-text-muted">Who can access</span>
              <span className="flex items-center gap-1 text-[11px] text-text-muted">
                <Icon name="lock" size={12} />
                Private
              </span>
            </div>

            <div className="flex max-h-[92px] min-h-9 flex-wrap items-center gap-1.5 overflow-y-auto rounded-[8px] border border-border bg-surface-3 px-2 py-1.5 transition focus-within:border-accent">
              {selectedRoles.map((id) => {
                const role = roles.find((entry) => entry.id === id);
                return (
                  <WhitelistChip
                    key={`role:${id}`}
                    label={`@${role?.name ?? id}`}
                    color={role?.color ?? null}
                    onRemove={() => toggleRole(id)}
                  />
                );
              })}
              {selectedMembers.map((userId) => {
                const member = members.find((entry) => entry.userId === userId);
                return (
                  <WhitelistChip
                    key={`member:${userId}`}
                    label={member?.displayName ?? userId}
                    color={member?.roleColor ?? null}
                    onRemove={() => toggleMember(userId)}
                  />
                );
              })}
              <input
                aria-label="Search roles and people"
                placeholder={
                  selectedRoles.length + selectedMembers.length === 0 ? "Add roles or people" : ""
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && query.length === 0) {
                    if (selectedMembers.length > 0) {
                      toggleMember(selectedMembers[selectedMembers.length - 1] as string);
                    } else if (selectedRoles.length > 0) {
                      toggleRole(selectedRoles[selectedRoles.length - 1] as string);
                    }
                  }
                }}
                className="min-w-[8rem] flex-1 bg-transparent px-1 text-[13px] text-text placeholder:text-text-muted focus-visible:outline-none"
              />
            </div>

            <ul className="stagger flex max-h-[148px] flex-col overflow-y-auto">
              {filteredRoles.map((role) => {
                const checked = selectedRoles.includes(role.id);
                return (
                  <li key={`role:${role.id}`}>
                    <WhitelistOption
                      checked={checked}
                      label={role.name}
                      description="Role"
                      color={role.color ?? null}
                      onToggle={() => toggleRole(role.id)}
                    />
                  </li>
                );
              })}
              {filteredMembers.map((member) => {
                const checked = selectedMembers.includes(member.userId);
                return (
                  <li key={`member:${member.userId}`}>
                    <WhitelistOption
                      checked={checked}
                      label={member.displayName}
                      description="Member"
                      color={member.roleColor ?? null}
                      onToggle={() => toggleMember(member.userId)}
                    />
                  </li>
                );
              })}
              {filteredRoles.length === 0 && filteredMembers.length === 0 && (
                <li className="px-2.5 py-4 text-center text-[12px] text-text-muted">
                  No roles or people match that search.
                </li>
              )}
            </ul>

            <p className="flex items-center gap-1.5 text-[11px] leading-snug text-text-muted">
              <span className="shrink-0 rounded-full border border-border px-1.5 py-px font-medium">
                @everyone
              </span>
              has no access unless you add a role or person here.
            </p>
          </div>
        )}

        <button type="button" data-primary className="hidden">
          Submit
        </button>
      </form>
    </Modal>
  );
}

function KindOption({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  return (
    <label
      className={cn(
        "group relative flex cursor-pointer flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.98]",
        active
          ? "border-accent bg-accent-soft shadow-sm shadow-black/5"
          : "border-border bg-surface-1 hover:border-text-muted/40 hover:bg-surface-2",
      )}
    >
      <input
        type="radio"
        name="channel-kind"
        checked={active}
        onChange={onClick}
        className="sr-only"
      />
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors",
          active ? "bg-accent/15 text-accent" : "bg-surface-3 text-text-muted",
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] font-semibold text-text">{title}</span>
      <span className="text-[11px] leading-snug text-text-muted">{description}</span>
      {active && (
        <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
          <Icon name="check" size={11} strokeWidth={2.5} />
        </span>
      )}
    </label>
  );
}

function WhitelistChip({
  label,
  color,
  onRemove,
}: {
  readonly label: string;
  readonly color: string | null;
  readonly onRemove: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onClick={onRemove}
      className="flex max-w-[180px] items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-[11px] font-medium text-accent transition hover:brightness-110"
    >
      {color !== null && color.length > 0 && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{label}</span>
      <Icon name="x" size={11} className="shrink-0" />
    </button>
  );
}

function WhitelistOption({
  checked,
  label,
  description,
  color,
  onToggle,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly description: string;
  readonly color: string | null;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition hover:bg-surface-3"
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-surface-3"
      >
        {color !== null && color.length > 0 ? (
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        ) : (
          <Icon
            name={description === "Role" ? "user-plus" : "message"}
            size={12}
            className="text-text-muted"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text">{label}</span>
        <span className="block text-[11px] text-text-muted">{description}</span>
      </span>
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
          checked ? "border-accent bg-accent text-on-accent" : "border-border",
        )}
      >
        {checked && <Icon name="check" size={13} strokeWidth={2.5} />}
      </span>
    </button>
  );
}
