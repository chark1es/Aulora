import { Badge, Button, Icon } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { msUntilNextExpiry, stillWaiting, waitingLabel } from "../../lib/guest/lobby";
import { useVoice } from "../../providers/VoiceProvider";

/**
 * The live "N waiting" prompt for people allowed to answer guests in this call:
 * holders of Manage guest access, and the creator of the call’s link. Everyone
 * else renders nothing and never subscribes to the lobby.
 */
export function GuestLobbyPrompt() {
  const voice = useVoice();
  const callId = voice.call?.id ?? null;
  const access = useQuery(
    api.guestCalls.lobbyAccess,
    callId !== null ? { callId: callId as never } : "skip",
  );
  if (callId === null || access?.canManage !== true) {
    return null;
  }
  return <LobbyList callId={callId} />;
}

export function LobbyList({ callId }: { readonly callId: string }) {
  const lobby = useQuery(api.guestCalls.lobbyList, { callId: callId as never });
  const admit = useMutation(api.guestCalls.admit);
  const deny = useMutation(api.guestCalls.deny);
  const remove = useMutation(api.guestCalls.remove);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A request lapses by time alone, so re-render exactly when the next one does.
  const nextExpiry =
    lobby === undefined
      ? null
      : msUntilNextExpiry([...lobby.pending, ...lobby.admitted], Date.now());
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

  if (lobby === undefined) {
    return null;
  }
  // Expired requests (and sessions past their cap) are gone on the server: do not offer Admit.
  const pending = stillWaiting(lobby.pending, now);
  const admitted = stillWaiting(lobby.admitted, now);
  if (pending.length === 0 && admitted.length === 0 && error === null) {
    return null;
  }

  const act = (id: string, work: Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    void work
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "That did not work. Try again.",
        );
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  return (
    <aside
      aria-label="Guests"
      className="fixed right-3 top-[calc(var(--titlebar-height)+12px)] z-[85] flex max-h-[70vh] w-[min(340px,calc(100vw-24px))] flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface-1 p-3 shadow-2xl shadow-black/30"
    >
      {pending.length > 0 && (
        <section aria-labelledby="lobby-waiting" className="flex flex-col gap-2">
          <h2 id="lobby-waiting" className="text-[13px] font-semibold text-text">
            <span role="status">{waitingLabel(pending.length)}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {pending.map((guest) => (
              <li
                key={guest.guestSessionId}
                className="flex items-center gap-2 rounded-[10px] bg-surface-2 p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text">{guest.displayName}</p>
                  {guest.affiliation !== null && (
                    <p className="truncate text-[11.5px] text-text-muted">{guest.affiliation}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="success"
                  disabled={busyId !== null}
                  loading={busyId === guest.guestSessionId}
                  aria-label={`Admit ${guest.displayName}`}
                  onClick={() => {
                    act(guest.guestSessionId, admit({ guestSessionId: guest.guestSessionId }));
                  }}
                >
                  Admit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId !== null}
                  aria-label={`Deny ${guest.displayName}`}
                  onClick={() => {
                    act(guest.guestSessionId, deny({ guestSessionId: guest.guestSessionId }));
                  }}
                >
                  Deny
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {admitted.length > 0 && (
        <section aria-labelledby="lobby-admitted" className="flex flex-col gap-1.5">
          <h2 id="lobby-admitted" className="text-[12px] font-semibold text-text-muted">
            Guests in this call
          </h2>
          <ul className="flex flex-col gap-1">
            {admitted.map((guest) => (
              <li key={guest.guestSessionId} className="flex items-center gap-2 py-0.5">
                <Icon name="users" size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
                  {guest.displayName}
                </span>
                <Badge size="sm">Guest</Badge>
                <button
                  type="button"
                  aria-label={`Remove ${guest.displayName} from the call`}
                  title="Remove from call"
                  disabled={busyId !== null}
                  onClick={() => {
                    act(guest.guestSessionId, remove({ guestSessionId: guest.guestSessionId }));
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition hover:bg-danger/10 hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error !== null && (
        <p role="alert" className="text-[12px] text-danger-text">
          {error}
        </p>
      )}
    </aside>
  );
}
