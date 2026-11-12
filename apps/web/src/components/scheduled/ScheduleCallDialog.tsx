import {
  type ChannelSummary,
  canCreateGuestLinks,
  formatLocalDateTime,
  formatZoneName,
  fromDateTimeLocalValue,
  SCHEDULED_CALL_DEFAULT_OPEN_LEAD_MINUTES,
  SCHEDULED_CALL_DESCRIPTION_MAX,
  SCHEDULED_CALL_TITLE_MAX,
  toDateTimeLocalValue,
  viewerTimeZone,
} from "@aulora/core";
import {
  Button,
  Checkbox,
  Field,
  Icon,
  Input,
  Modal,
  ModalFooter,
  SegmentedControl,
  Select,
  Text,
  Textarea,
} from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  DURATION_CHOICES,
  OPEN_LEAD_CHOICES,
  type ScheduleDraft,
  type ScheduleTarget,
  scheduledGuestLinkTtlMs,
  toggleId,
  validateDraft,
} from "../../lib/scheduled/form";
import type { RoleView } from "../../lib/workspace-admin";
import { roleRef } from "../../lib/workspace-admin";
import { useClipboardCopy } from "../admin/useClipboardCopy";
import type { MemberEntry } from "../chat/MembersPanel";
import { PersonAvatar } from "../chat/member-avatars";
import { type PeopleOption, PeoplePicker } from "../chat/PeoplePicker";

export interface EditableScheduledCall {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly startsAt: number;
  readonly durationMinutes: number | null;
  readonly openLeadMinutes: number;
  readonly channelId: string | null;
  readonly inviteeUserIds: readonly string[];
  readonly inviteeRoleIds: readonly string[];
}

export interface ScheduleCallDialogProps {
  /** `null` creates a new call; a call edits it. */
  readonly editing: EditableScheduledCall | null;
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly guestCallsEnabled: boolean;
  readonly members: readonly MemberEntry[];
  readonly roles: readonly RoleView[];
  readonly channels: readonly ChannelSummary[];
  readonly titles: ReadonlyMap<string, string>;
  /** A suggested start for a new call, as the next round half hour. */
  readonly onClose: () => void;
}

const CALL_CHANNEL_KINDS = new Set(["voice", "dm", "group_dm"]);

function nextHalfHour(now: number): number {
  const half = 30 * 60_000;
  return Math.ceil((now + 5 * 60_000) / half) * half;
}

function RoleSwatch({ color, size }: { readonly color: string | null; readonly size: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-muted"
      style={{ width: size, height: size }}
    >
      {color !== null && color.length > 0 ? (
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      ) : (
        <Icon name="shield" size={Math.round(size * 0.48)} />
      )}
    </span>
  );
}

function initialDraft(editing: EditableScheduledCall | null, now: number): ScheduleDraft {
  if (editing !== null) {
    return {
      title: editing.title,
      description: editing.description,
      startLocal: toDateTimeLocalValue(editing.startsAt),
      durationMinutes: editing.durationMinutes === null ? "" : String(editing.durationMinutes),
      openLeadMinutes: editing.openLeadMinutes,
      target: editing.channelId === null ? "standalone" : "channel",
      channelId: editing.channelId ?? "",
      inviteeUserIds: editing.inviteeUserIds,
      inviteeRoleIds: editing.inviteeRoleIds,
    };
  }
  return {
    title: "",
    description: "",
    startLocal: toDateTimeLocalValue(nextHalfHour(now)),
    durationMinutes: "30",
    openLeadMinutes: SCHEDULED_CALL_DEFAULT_OPEN_LEAD_MINUTES,
    target: "standalone",
    channelId: "",
    inviteeUserIds: [],
    inviteeRoleIds: [],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Could not save the call. Try again.";
}

/**
 * Create or edit a scheduled call. The date and time are entered, and echoed
 * back, in the viewer’s own time zone; only the UTC instant is sent, so the
 * server never stores local time and every invitee sees their own local start.
 */
export function ScheduleCallDialog(props: ScheduleCallDialogProps) {
  const { editing, ownUserId, permissions, guestCallsEnabled, onClose } = props;
  const create = useMutation(api.scheduledCalls.create);
  const update = useMutation(api.scheduledCalls.update);
  const createLink = useMutation(api.guestCalls.createLink);
  const now = useMemo(() => Date.now(), []);
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialDraft(editing, now));
  const [wantGuestLink, setWantGuestLink] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestUrl, setGuestUrl] = useState<{ url: string; expiresAt: number } | null>(null);
  const [query, setQuery] = useState("");
  const zone = viewerTimeZone();
  const isEditing = editing !== null;
  const offersGuestLink = !isEditing && canCreateGuestLinks(permissions, guestCallsEnabled);
  const { errors, value } = validateDraft(draft, Date.now(), undefined, isEditing);

  const channelOptions = props.channels
    .filter((channel) => CALL_CHANNEL_KINDS.has(channel.kind))
    .map((channel) => ({
      value: channel.id,
      label: props.titles.get(channel.id) ?? channel.name ?? "Conversation",
      description:
        channel.kind === "voice"
          ? "Voice channel"
          : channel.kind === "dm"
            ? "Direct message"
            : "Group message",
    }));

  const peopleOptions = useMemo<readonly PeopleOption[]>(() => {
    const roleRows = props.roles
      .filter((role) => !role.isEveryone)
      .map((role) => ({
        id: `role:${roleRef(role)}`,
        label: role.name,
        sublabel: "Role",
        leading: (size: number) => <RoleSwatch color={role.color} size={size} />,
      }));
    const memberRows = props.members
      .filter((member) => member.userId !== ownUserId)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((member) => ({
        id: member.userId,
        label: member.displayName,
        leading: (size: number) => <PersonAvatar userId={member.userId} size={size} />,
      }));
    return [...roleRows, ...memberRows];
  }, [props.roles, props.members, ownUserId]);

  const set = (patch: Partial<ScheduleDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const save = () => {
    setSubmitted(true);
    if (value === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const standalone = draft.target === "standalone";
    const work = async () => {
      if (editing !== null) {
        await update({
          scheduledCallId: editing.id as never,
          title: value.title,
          description: value.description,
          startsAt: value.startsAt,
          ...(value.durationMinutes !== null ? { durationMinutes: value.durationMinutes } : {}),
          openLeadMinutes: value.openLeadMinutes,
          ...(editing.channelId === null
            ? {
                inviteeUserIds: [...draft.inviteeUserIds],
                inviteeRoleIds: [...draft.inviteeRoleIds],
              }
            : {}),
        });
        return null;
      }
      const id = await create({
        title: value.title,
        ...(value.description.length > 0 ? { description: value.description } : {}),
        startsAt: value.startsAt,
        ...(value.durationMinutes !== null ? { durationMinutes: value.durationMinutes } : {}),
        openLeadMinutes: value.openLeadMinutes,
        ...(standalone
          ? {
              inviteeUserIds: [...draft.inviteeUserIds],
              inviteeRoleIds: [...draft.inviteeRoleIds],
            }
          : { channelId: draft.channelId as never }),
      });
      if (!wantGuestLink) {
        return null;
      }
      try {
        const link = await createLink({
          scheduledCallId: id,
          expiresInMs: scheduledGuestLinkTtlMs(value.startsAt, value.durationMinutes, Date.now()),
        });
        return { url: link.url, expiresAt: link.expiresAt };
      } catch {
        // The call exists; the person can make the link from its row.
        return null;
      }
    };
    void work()
      .then((link) => {
        if (link !== null) {
          setGuestUrl(link);
        } else {
          onClose();
        }
      })
      .catch((cause: unknown) => {
        setError(errorText(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (guestUrl !== null) {
    return <GuestLinkSaved link={guestUrl} onClose={onClose} />;
  }

  const show = (key: keyof typeof errors): string | undefined =>
    submitted ? errors[key] : undefined;
  const fieldError = (key: keyof typeof errors): { error?: string } => {
    const message = show(key);
    return message === undefined ? {} : { error: message };
  };
  const preview =
    value !== null
      ? `Starts ${formatLocalDateTime(value.startsAt, now)}`
      : (() => {
          const at = fromDateTimeLocalValue(draft.startLocal);
          return at === null ? null : `Starts ${formatLocalDateTime(at, now)}`;
        })();

  return (
    <Modal
      open
      onClose={onClose}
      label={isEditing ? "Edit scheduled call" : "Schedule a call"}
      title={isEditing ? "Edit scheduled call" : "Schedule a call"}
      size="lg"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={busy} onClick={save}>
            {isEditing ? "Save changes" : "Schedule call"}
          </Button>
        </ModalFooter>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Input
          label="Title"
          value={draft.title}
          maxLength={SCHEDULED_CALL_TITLE_MAX}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
          {...fieldError("title")}
        />
        <Textarea
          label="Description (optional)"
          rows={3}
          value={draft.description}
          maxLength={SCHEDULED_CALL_DESCRIPTION_MAX}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
          {...fieldError("description")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Date and time"
            type="datetime-local"
            value={draft.startLocal}
            onChange={(event) => {
              set({ startLocal: event.target.value });
            }}
            hint={
              preview !== null
                ? `${preview}. Your time zone: ${zone.replace(/_/gu, " ")} (${formatZoneName(Date.now())}).`
                : `Your time zone: ${zone.replace(/_/gu, " ")}.`
            }
            {...fieldError("start")}
          />
          <Select
            label="How long"
            value={draft.durationMinutes}
            onChange={(durationMinutes) => {
              set({ durationMinutes });
            }}
            options={[
              ...(isEditing && editing.durationMinutes !== null
                ? []
                : [{ value: "", label: "No set length" }]),
              ...DURATION_CHOICES.map((minutes) => ({
                value: String(minutes),
                label:
                  minutes < 60
                    ? `${minutes} minutes`
                    : minutes === 60
                      ? "1 hour"
                      : `${minutes / 60} hours`,
              })),
            ]}
          />
        </div>
        <Select
          label="People can join"
          value={String(draft.openLeadMinutes)}
          onChange={(minutes) => {
            set({ openLeadMinutes: Number(minutes) });
          }}
          options={OPEN_LEAD_CHOICES.map((minutes) => ({
            value: String(minutes),
            label:
              minutes === 0
                ? "Only at the start time"
                : `${minutes} ${minutes === 1 ? "minute" : "minutes"} before the start`,
          }))}
        />

        {!isEditing && (
          <SegmentedControl<ScheduleTarget>
            label="Where"
            value={draft.target}
            onChange={(target) => {
              set({ target });
            }}
            options={[
              { value: "standalone", label: "Standalone room" },
              { value: "channel", label: "In a channel" },
            ]}
          />
        )}

        {draft.target === "channel" ? (
          isEditing ? (
            <Text tone="muted" size="sm">
              This call lives in{" "}
              <strong className="text-text">
                {props.titles.get(editing.channelId ?? "") ?? "a channel"}
              </strong>
              . The channel cannot change after scheduling.
            </Text>
          ) : (
            <Select
              label="Channel or conversation"
              value={draft.channelId}
              placeholder="Choose where to call"
              onChange={(channelId) => {
                set({ channelId });
              }}
              options={channelOptions}
            />
          )
        ) : (
          <Field
            label="Invite"
            hint="Standalone rooms are only open to the people and roles you list, and to you."
            {...fieldError("invitees")}
          >
            <PeoplePicker
              options={peopleOptions}
              selected={[
                ...draft.inviteeRoleIds.map((id) => `role:${id}`),
                ...draft.inviteeUserIds,
              ]}
              onToggle={(id) => {
                if (id.startsWith("role:")) {
                  set({ inviteeRoleIds: toggleId(draft.inviteeRoleIds, id.slice(5)) });
                } else {
                  set({ inviteeUserIds: toggleId(draft.inviteeUserIds, id) });
                }
              }}
              query={query}
              onQueryChange={setQuery}
              searchLabel="Search roles and people"
              placeholder="Add people or roles"
              emptyText="No roles or people match that search."
              listClassName="max-h-[180px]"
            />
          </Field>
        )}
        {show("channel") !== undefined && (
          <Text tone="danger" size="sm" role="alert">
            {show("channel")}
          </Text>
        )}

        {offersGuestLink && (
          <Checkbox
            checked={wantGuestLink}
            onChange={setWantGuestLink}
            label="Also create a guest link"
            description="Lets someone without an account ask to join. It stops working shortly after the call is due to end."
          />
        )}

        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
      </form>
    </Modal>
  );
}

function GuestLinkSaved({
  link,
  onClose,
}: {
  readonly link: { readonly url: string; readonly expiresAt: number };
  readonly onClose: () => void;
}) {
  const { copied, copy } = useClipboardCopy(link.url);
  return (
    <Modal
      open
      onClose={onClose}
      label="Call scheduled"
      title="Call scheduled"
      description="Copy the guest link now: it is shown only once."
      size="md"
      footer={
        <ModalFooter>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      }
    >
      <Field
        label="Guest link"
        hint={`Works until ${formatLocalDateTime(link.expiresAt)}. Guests wait in a lobby until someone admits them.`}
      >
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Guest link"
            value={link.url}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-border bg-surface-3 px-2.5 font-mono text-[12px] text-text focus-visible:border-accent focus-visible:outline-none"
          />
          <Button
            variant={copied ? "success" : "primary"}
            onClick={copy}
            leading={<Icon name={copied ? "check" : "copy"} size={15} />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Field>
    </Modal>
  );
}
