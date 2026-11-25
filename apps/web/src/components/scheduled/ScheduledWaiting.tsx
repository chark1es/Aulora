import { callRefusalMessage } from "@aulora/core";
import { Badge, Button, Icon } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { msUntilNextExpiry, stillWaiting, waitingLabel } from "../../lib/guest/lobby";
import { type MyWaiting, waitingReady } from "../../lib/scheduled/waiting";
import { useVoice } from "../../providers/VoiceProvider";
import { useNow } from "./use-now";

/**
 * The member side of the scheduled-call waiting room.
 *
 * `ScheduledWaitingWatcher` is mounted once at the chat shell (next to the guest
 * lobby prompt), so a member who is waiting keeps waiting, and is let in
 * automatically, while they switch channels or tabs. The host side is a prompt
 * for the call they are in plus a compact list on each Scheduled-tab row.
 */

/** A person waiting for a host, as `scheduledCalls.waitingList` returns them. */
export interface HostWaiting {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly kind: "early" | "knock";
  readonly requestedAt: number;
  readonly expiresAt: number;
}

function messageOf(cause: unknown, fallback: string): string {
  const refusal = callRefusalMessage(cause);
  if (refusal !== null) {
    return refusal;
  }
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

/** The caller's own waiting rows. One shared subscription for the whole shell. */
export function useMyWaiting(): readonly MyWaiting[] | undefined {
  return useQuery(api.scheduledCalls.mine, {}) as readonly MyWaiting[] | undefined;
}

/**
 * Joins the member automatically once a waiting row is ready (an early arrival
 * after the call opens, or anyone a host let in). It never pulls someone out of
 * a call they are already in: they keep the Join button on the Scheduled row.
 * A join the server refuses clears the row and reports why.
 */
export function ScheduledWaitingWatcher() {
  const voice = useVoice();
  const mine = useMyWaiting();
  const leave = useMutation(api.scheduledCalls.leave);
  const hasEarly = mine?.some((row) => row.state === "waiting" && row.kind === "early") === true;
  const now = useNow(5_000, hasEarly);
  const attempted = useRef(new Set<string>());
  const busy = useRef(false);
  const inCall = voice.call !== null;

  useEffect(() => {
    if (mine === undefined || inCall || busy.current) {
      return;
    }
    const ready = mine.find(
      (row) => waitingReady(row, now) && !attempted.current.has(`${row.id}:${row.state}`),
    );
    if (ready === undefined) {
      return;
    }
    attempted.current.add(`${ready.id}:${ready.state}`);
    busy.current = true;
    void voice
      .joinScheduledCall(ready.scheduledCallId, ready.title)
      .then(async (result) => {
        if (!result.ok) {
          voice.reportError(result.message);
          await leave({ scheduledCallId: ready.scheduledCallId as never });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
      });
  }, [mine, now, inCall, voice, leave]);

  return null;
}

/** Admit/decline for people waiting on a call, shared by the prompt and the row. */
function useWaitingActions() {
  const admit = useMutation(api.scheduledCalls.admit);
  const decline = useMutation(api.scheduledCalls.decline);
  const admitAllEarly = useMutation(api.scheduledCalls.admitAllEarly);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (id: string, work: Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    void work
      .catch((cause: unknown) => {
        setError(messageOf(cause, "That did not work. Try again."));
      })
      .finally(() => {
        setBusyId(null);
      });
  };
  return {
    busyId,
    error,
    admit: (row: HostWaiting) => {
      act(row.id, admit({ waitingId: row.id as never }));
    },
    decline: (row: HostWaiting) => {
      act(row.id, decline({ waitingId: row.id as never }));
    },
    admitAll: (scheduledCallId: string) => {
      act("all", admitAllEarly({ scheduledCallId: scheduledCallId as never }));
    },
  };
}

/** The requests that are still live, re-evaluated when the next one lapses. */
function useLiveRequests(rows: readonly HostWaiting[] | undefined): HostWaiting[] {
  const [now, setNow] = useState(() => Date.now());
  const nextExpiry = rows === undefined ? null : msUntilNextExpiry(rows, Date.now());
  useEffect(() => {
    if (nextExpiry === null) {
      return;
    }
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, Math.min(nextExpiry, 2_147_000_000) + 50);
    return () => {
      clearTimeout(timer);
    };
  }, [nextExpiry]);
  return rows === undefined ? [] : stillWaiting(rows, now);
}

function WaitingRows({
  rows,
  actions,
  scheduledCallId,
}: {
  readonly rows: readonly HostWaiting[];
  readonly actions: ReturnType<typeof useWaitingActions>;
  readonly scheduledCallId: string;
}) {
  const earlyCount = rows.filter((row) => row.kind === "early").length;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 rounded-[10px] bg-surface-2 p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-text">{row.displayName}</p>
              <p className="truncate text-[11.5px] text-text-muted">
                {row.kind === "early" ? "Here early" : "Asking to join"}
              </p>
            </div>
            <Button
              size="sm"
              variant="success"
              disabled={actions.busyId !== null}
              loading={actions.busyId === row.id}
              aria-label={`${row.kind === "early" ? "Let in" : "Admit"} ${row.displayName}`}
              onClick={() => {
                actions.admit(row);
              }}
            >
              {row.kind === "early" ? "Let in" : "Admit"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={actions.busyId !== null}
              aria-label={`Decline ${row.displayName}`}
              onClick={() => {
                actions.decline(row);
              }}
            >
              Decline
            </Button>
          </li>
        ))}
      </ul>
      {earlyCount > 1 && (
        <Button
          size="sm"
          variant="secondary"
          disabled={actions.busyId !== null}
          loading={actions.busyId === "all"}
          onClick={() => {
            actions.admitAll(scheduledCallId);
          }}
        >
          Let everyone in
        </Button>
      )}
      {actions.error !== null && (
        <p role="alert" className="text-[12px] text-danger-text">
          {actions.error}
        </p>
      )}
    </>
  );
}

/**
 * The live "N waiting" prompt for hosts of the scheduled call they are in:
 * administrators, and whoever may manage that call. Everyone else renders
 * nothing and never subscribes to the list.
 */
export function ScheduledWaitingPrompt() {
  const voice = useVoice();
  const scheduledCallId = voice.call?.scheduledCallId ?? null;
  const access = useQuery(
    api.scheduledCalls.waitingAccess,
    scheduledCallId !== null ? { scheduledCallId: scheduledCallId as never } : "skip",
  );
  if (scheduledCallId === null || access?.canManage !== true) {
    return null;
  }
  return <WaitingPrompt scheduledCallId={scheduledCallId} />;
}

export function WaitingPrompt({ scheduledCallId }: { readonly scheduledCallId: string }) {
  const data = useQuery(api.scheduledCalls.waitingList, {
    scheduledCallId: scheduledCallId as never,
  }) as { readonly waiting: readonly HostWaiting[] } | undefined;
  const actions = useWaitingActions();
  const rows = useLiveRequests(data?.waiting);
  if (rows.length === 0 && actions.error === null) {
    return null;
  }
  return (
    <aside
      aria-label="People waiting to join"
      className="fixed bottom-4 right-3 z-[85] flex max-h-[60vh] w-[min(340px,calc(100vw-24px))] flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface-1 p-3 shadow-2xl shadow-black/30"
    >
      <h2 className="text-[13px] font-semibold text-text">
        <span role="status">{waitingLabel(rows.length)}</span>
      </h2>
      <WaitingRows rows={rows} actions={actions} scheduledCallId={scheduledCallId} />
    </aside>
  );
}

/**
 * The compact waiting list on a Scheduled-tab row, so a host can let people in
 * before they have joined the call themselves. Subscribes only when asked to.
 */
export function RowWaitingControls({
  scheduledCallId,
  enabled,
}: {
  readonly scheduledCallId: string;
  readonly enabled: boolean;
}) {
  const data = useQuery(
    api.scheduledCalls.waitingList,
    enabled ? { scheduledCallId: scheduledCallId as never } : "skip",
  ) as { readonly waiting: readonly HostWaiting[] } | undefined;
  const actions = useWaitingActions();
  const rows = useLiveRequests(data?.waiting);
  if (rows.length === 0 && actions.error === null) {
    return null;
  }
  return (
    <section
      aria-label="People waiting to join"
      className="flex flex-col gap-2 rounded-[10px] border border-border/60 bg-surface-2/50 p-2.5"
      data-testid={`scheduled-waiting-${scheduledCallId}`}
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-text">
        <Icon name="users" size={14} className="text-text-muted" />
        <span role="status">{waitingLabel(rows.length)}</span>
        <Badge size="sm">Waiting</Badge>
      </div>
      <WaitingRows rows={rows} actions={actions} scheduledCallId={scheduledCallId} />
    </section>
  );
}
