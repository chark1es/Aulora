import {
  type ChannelSummary,
  canCreateGuestLinks,
  canEditScheduledCall,
  canScheduleCalls,
  formatCallTimeRange,
  formatLocalTimeWithZone,
  formatOpensIn,
  formatZoneName,
  groupByLocalDay,
  SCHEDULED_CALL_LIST_LIMIT,
  type ScheduledCallStatus,
  scheduledJoinState,
  splitScheduledCalls,
  viewerTimeZone,
} from "@aulora/core";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  Spinner,
  Text,
} from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { RoleView } from "../../lib/workspace-admin";
import { useVoice } from "../../providers/VoiceProvider";
import { AddonBoundary } from "../addons/AddonBoundary";
import type { MemberEntry } from "../chat/MembersPanel";
import { GuestLinkDialog } from "../voice/InviteGuestDialog";
import { type EditableScheduledCall, ScheduleCallDialog } from "./ScheduleCallDialog";
import { useNow } from "./use-now";

export interface ScheduledCallsViewProps {
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly members: readonly MemberEntry[];
  readonly roles: readonly RoleView[];
  readonly channels: readonly ChannelSummary[];
  readonly titles: ReadonlyMap<string, string>;
  readonly guestCallsEnabled: boolean;
  readonly onBack: () => void;
}

interface ScheduledCall {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly startsAt: number;
  readonly durationMinutes: number | null;
  readonly openLeadMinutes: number;
  readonly opensAt: number;
  readonly channelId: string | null;
  readonly inviteeUserIds: readonly string[];
  readonly inviteeRoleIds: readonly string[];
  readonly createdBy: string;
  readonly status: ScheduledCallStatus;
  readonly callId: string | null;
  readonly canManage: boolean;
  readonly canJoin: boolean;
}

/** The Scheduled tab: upcoming and past calls, in the viewer’s own time zone. */
export function ScheduledCallsView(props: ScheduledCallsViewProps) {
  return (
    <AddonBoundary title="Scheduled calls" onBack={props.onBack}>
      <ScheduledCallsBody {...props} />
    </AddonBoundary>
  );
}

type Dialog =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly call: ScheduledCall }
  | { readonly kind: "cancel"; readonly call: ScheduledCall }
  | { readonly kind: "guest"; readonly call: ScheduledCall };

function ScheduledCallsBody(props: ScheduledCallsViewProps) {
  const { permissions, guestCallsEnabled } = props;
  const calls = useQuery(api.scheduledCalls.list, { limit: SCHEDULED_CALL_LIST_LIMIT }) as
    | readonly ScheduledCall[]
    | undefined;
  const cancel = useMutation(api.scheduledCalls.cancel);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(20_000);
  const zone = viewerTimeZone().replace(/_/gu, " ");
  const canSchedule = canScheduleCalls(permissions, true);

  const { upcoming, past } = splitScheduledCalls(calls ?? [], now);
  const upcomingGroups = groupByLocalDay(upcoming, (call) => call.startsAt, now, "asc");
  const pastGroups = groupByLocalDay(past, (call) => call.startsAt, now, "desc");

  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Scheduled calls">
      <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <IconButton label="Back to chat" size="sm" onClick={props.onBack} className="md:hidden">
          <Icon name="chevron-left" size={18} />
        </IconButton>
        <Icon name="calendar" size={18} className="text-accent" />
        <h1 className="min-w-0 truncate text-[15px] font-semibold">Scheduled calls</h1>
        <span className="flex-1" />
        <span className="hidden text-xs text-text-muted sm:inline" data-testid="scheduled-zone">
          Times in {zone} ({formatZoneName(now)})
        </span>
        {canSchedule && (
          <Button
            size="sm"
            leading={<Icon name="plus" size={14} />}
            onClick={() => {
              setDialog({ kind: "create" });
            }}
          >
            Schedule
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-6">
          <p className="text-xs text-text-muted sm:hidden">
            Times in {zone} ({formatZoneName(now)})
          </p>
          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}
          {calls === undefined ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading scheduled calls" />
            </div>
          ) : upcoming.length === 0 && past.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No scheduled calls"
              description={
                canSchedule
                  ? "Schedule a call and invite people. It opens for joining a little before it starts."
                  : "Calls you are invited to will show up here."
              }
              {...(canSchedule
                ? {
                    action: (
                      <Button
                        onClick={() => {
                          setDialog({ kind: "create" });
                        }}
                      >
                        Schedule a call
                      </Button>
                    ),
                  }
                : {})}
            />
          ) : (
            <>
              <CallSection
                title="Upcoming"
                emptyText="Nothing coming up."
                groups={upcomingGroups}
                now={now}
                guestLinks={canCreateGuestLinks(permissions, guestCallsEnabled)}
                titles={props.titles}
                onEdit={(call) => {
                  setDialog({ kind: "edit", call });
                }}
                onCancel={(call) => {
                  setDialog({ kind: "cancel", call });
                }}
                onGuest={(call) => {
                  setDialog({ kind: "guest", call });
                }}
              />
              {past.length > 0 && (
                <section className="flex flex-col gap-3">
                  <button
                    type="button"
                    aria-expanded={showPast}
                    onClick={() => {
                      setShowPast((open) => !open);
                    }}
                    className="flex w-fit items-center gap-1 rounded-[6px] text-[13px] font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Icon name={showPast ? "chevron-down" : "chevron-right"} size={14} />
                    Past ({past.length})
                  </button>
                  {showPast && (
                    <CallSection
                      groups={pastGroups}
                      now={now}
                      guestLinks={false}
                      titles={props.titles}
                      onEdit={() => undefined}
                      onCancel={() => undefined}
                      onGuest={() => undefined}
                    />
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {dialog?.kind === "create" && (
        <ScheduleCallDialog
          editing={null}
          ownUserId={props.ownUserId}
          permissions={permissions}
          guestCallsEnabled={guestCallsEnabled}
          members={props.members}
          roles={props.roles}
          channels={props.channels}
          titles={props.titles}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <ScheduleCallDialog
          editing={dialog.call satisfies EditableScheduledCall}
          ownUserId={props.ownUserId}
          permissions={permissions}
          guestCallsEnabled={guestCallsEnabled}
          members={props.members}
          roles={props.roles}
          channels={props.channels}
          titles={props.titles}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "guest" && (
        <GuestLinkDialog
          target={{ scheduledCallId: dialog.call.id }}
          callId={dialog.call.callId}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === "cancel"}
        onClose={() => {
          setDialog(null);
        }}
        title="Cancel this call?"
        description={
          dialog?.kind === "cancel"
            ? `“${dialog.call.title}” will be cancelled and its room closed if it is open. Invitees will see it as cancelled.`
            : ""
        }
        confirmLabel="Cancel call"
        cancelLabel="Keep it"
        variant="danger"
        icon="calendar"
        onConfirm={() => {
          const target = dialog;
          setDialog(null);
          if (target?.kind !== "cancel") {
            return;
          }
          setError(null);
          void cancel({ scheduledCallId: target.call.id as never }).catch((cause: unknown) => {
            setError(
              cause instanceof Error && cause.message.length > 0
                ? cause.message
                : "Could not cancel the call. Try again.",
            );
          });
        }}
      />
    </section>
  );
}

function CallSection(props: {
  readonly title?: string;
  readonly emptyText?: string;
  readonly groups: ReturnType<typeof groupByLocalDay<ScheduledCall>>;
  readonly now: number;
  readonly guestLinks: boolean;
  readonly titles: ReadonlyMap<string, string>;
  readonly onEdit: (call: ScheduledCall) => void;
  readonly onCancel: (call: ScheduledCall) => void;
  readonly onGuest: (call: ScheduledCall) => void;
}) {
  const { title, groups } = props;
  return (
    <section className="flex flex-col gap-5">
      {title !== undefined && (
        <h2 className="text-[13px] font-semibold text-text-muted">{title}</h2>
      )}
      {groups.length === 0 && props.emptyText !== undefined && (
        <Text tone="muted" size="sm">
          {props.emptyText}
        </Text>
      )}
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          <h3 className="text-[12px] font-semibold text-text">{group.label}</h3>
          <ul className="divide-y divide-border/60 rounded-[12px] border border-border bg-surface-1">
            {group.items.map((call) => (
              <CallRow key={call.id} call={call} {...props} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function CallRow({
  call,
  now,
  guestLinks,
  titles,
  onEdit,
  onCancel,
  onGuest,
}: {
  readonly call: ScheduledCall;
  readonly now: number;
  readonly guestLinks: boolean;
  readonly titles: ReadonlyMap<string, string>;
  readonly onEdit: (call: ScheduledCall) => void;
  readonly onCancel: (call: ScheduledCall) => void;
  readonly onGuest: (call: ScheduledCall) => void;
}) {
  const voice = useVoice();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const state = scheduledJoinState(call, now);
  const actions = canEditScheduledCall(call);
  const where =
    call.channelId !== null
      ? (titles.get(call.channelId) ?? "A channel")
      : `${call.inviteeUserIds.length + call.inviteeRoleIds.length} invited`;
  const hintId = `scheduled-hint-${call.id}`;

  const join = () => {
    setJoining(true);
    setJoinError(null);
    void voice
      .joinScheduledCall(call.id, call.title)
      .then((result) => {
        if (!result.ok) {
          setJoinError(result.message);
        }
      })
      .finally(() => {
        setJoining(false);
      });
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid={`scheduled-call-${call.id}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex items-center gap-2">
            <h4 className="min-w-0 truncate text-[14px] font-semibold text-text">{call.title}</h4>
            {call.status === "open" && <Badge tone="success">Open now</Badge>}
            {call.status === "cancelled" && <Badge tone="danger">Cancelled</Badge>}
            {call.status === "ended" && <Badge>Ended</Badge>}
          </div>
          <p className="mt-0.5 text-[12.5px] tabular-nums text-text-muted">
            {formatCallTimeRange(call.startsAt, call.durationMinutes)}
            <span aria-hidden="true"> · </span>
            <span className="not-italic">
              <span className="sr-only">, </span>
              {where}
            </span>
          </p>
          {call.description.length > 0 && (
            <p className="mt-1 line-clamp-2 text-[12.5px] text-text-muted">{call.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {guestLinks && (call.status === "scheduled" || call.status === "open") && (
            <IconButton
              label={`Invite a guest to ${call.title}`}
              size="sm"
              onClick={() => {
                onGuest(call);
              }}
            >
              <Icon name="link" size={15} />
            </IconButton>
          )}
          {actions.edit && (
            <IconButton
              label={`Edit ${call.title}`}
              size="sm"
              onClick={() => {
                onEdit(call);
              }}
            >
              <Icon name="pencil" size={15} />
            </IconButton>
          )}
          {actions.cancel && (
            <IconButton
              label={`Cancel ${call.title}`}
              size="sm"
              variant="danger"
              onClick={() => {
                onCancel(call);
              }}
            >
              <Icon name="x" size={15} />
            </IconButton>
          )}
          {(state.kind === "open" || state.kind === "not-open") && (
            <Button
              size="sm"
              variant="success"
              loading={joining}
              disabled={state.kind === "not-open" || joining || !voice.canConnect}
              aria-describedby={state.kind === "not-open" ? hintId : undefined}
              leading={<Icon name="phone" size={14} />}
              onClick={join}
            >
              Join
            </Button>
          )}
        </div>
      </div>
      {state.kind === "not-open" && (
        <p id={hintId} className="text-[12px] text-text-muted" data-testid="scheduled-not-open">
          This call hasn’t started yet. It opens at {formatLocalTimeWithZone(state.opensAt)} (
          {formatOpensIn(state.opensInMs)})
        </p>
      )}
      {!voice.canConnect && state.kind !== "cancelled" && state.kind !== "ended" && (
        <p className="text-[12px] text-text-muted">
          {voice.policy.enabled
            ? "You do not have permission to join calls."
            : "Voice and video calls are disabled in this workspace."}
        </p>
      )}
      {joinError !== null && (
        <p role="alert" className="text-[12px] text-danger">
          {joinError}
        </p>
      )}
    </li>
  );
}
