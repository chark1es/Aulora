import { Button, Spinner } from "@aulora/ui-web";
import { type ConvexReactClient, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { type LobbyStatus, screenFor } from "../../lib/guest/page-state";
import type { GuestMediaChoices } from "./DeviceCheck";
import { GuestCallView } from "./GuestCallView";
import { GuestMessageScreen } from "./GuestMessageScreen";
import { useGuestEngine } from "./use-guest-engine";

/** Longest delay a browser timer reliably holds (about 24.8 days). */
const MAX_TIMER_MS = 2_147_000_000;

export interface GuestSessionProps {
  readonly client: ConvexReactClient;
  readonly convexUrl: string;
  readonly sessionToken: string;
  readonly title: string;
  readonly choices: GuestMediaChoices;
  readonly onFinished: () => void;
  readonly onAskAgain: (() => void) | null;
}

/**
 * Everything after the guest has asked to join: waiting, the call, and each way
 * it can end. The server's lobby status is the truth; this follows it live. A
 * failed read (the session is gone) is handled by the boundary above.
 */
export function GuestSession(props: GuestSessionProps) {
  const lobby = useQuery(api.guestCalls.lobby, { sessionToken: props.sessionToken });
  const [callEnded, setCallEnded] = useState(false);
  const onCallEnded = useCallback(() => {
    setCallEnded(true);
  }, []);
  // Once admitted, a later `expired` means the session ran out, not an unanswered request.
  const wasAdmitted = useRef(false);
  if (lobby?.status === "admitted") {
    wasAdmitted.current = true;
  }
  // The server reports a lapsed request as `expired` only when the query next runs,
  // and nothing writes a waiting guest's session to make it run again. So the page
  // also ends the wait at `expiresAt` itself. The server stays authoritative: this
  // applies only to the value the timer fired for, and fires once per `expiresAt`,
  // so a fresh answer (a clock running ahead of the server's) is shown as sent.
  const [lapsedFor, setLapsedFor] = useState<object | null>(null);
  const lapsedExpiry = useRef<number | null>(null);
  useEffect(() => {
    if (
      lobby === undefined ||
      lobby.status !== "pending" ||
      lapsedExpiry.current === lobby.expiresAt
    ) {
      return;
    }
    const timer = setTimeout(
      () => {
        lapsedExpiry.current = lobby.expiresAt;
        setLapsedFor(lobby);
      },
      Math.min(Math.max(0, lobby.expiresAt - Date.now()), MAX_TIMER_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [lobby]);
  const status: LobbyStatus | undefined =
    lobby === undefined
      ? undefined
      : lapsedFor === lobby && lobby.status === "pending"
        ? "expired"
        : (lobby.status as LobbyStatus);
  const screen = screenFor({
    resolving: false,
    linkOk: true,
    hasSession: true,
    lobby: status,
    callEnded,
    wasAdmitted: wasAdmitted.current,
  });
  const done =
    screen === "ended" || screen === "denied" || screen === "removed" || screen === "expired";

  // The session credential is useless once the visit is over: drop it.
  useEffect(() => {
    if (done) {
      props.onFinished();
    }
  }, [done, props.onFinished]);

  switch (screen) {
    case "loading":
      return (
        <main className="flex min-h-dvh items-center justify-center bg-bg">
          <Spinner size={28} label="Checking your request" />
        </main>
      );
    case "waiting":
      return <WaitingScreen name={lobby?.displayName ?? ""} {...props} />;
    case "in-call":
      return lobby?.callId === null || lobby === undefined ? null : (
        <InCall
          {...props}
          selfKey={lobby.guestSessionId}
          callId={lobby.callId}
          onCallEnded={onCallEnded}
        />
      );
    case "denied":
      return (
        <GuestMessageScreen
          icon="ban"
          title="You weren't let in"
          action={
            props.onAskAgain !== null ? (
              <Button variant="secondary" onClick={props.onAskAgain}>
                Ask again
              </Button>
            ) : undefined
          }
        >
          The people in the call didn't admit you. You can close this page.
        </GuestMessageScreen>
      );
    case "removed":
      return (
        <GuestMessageScreen icon="logout" title="You were removed from the call">
          Someone in the call removed you. You can close this page.
        </GuestMessageScreen>
      );
    case "expired":
      return (
        <GuestMessageScreen
          icon="clock"
          title="Your request expired"
          action={
            props.onAskAgain !== null ? (
              <Button onClick={props.onAskAgain}>Ask again</Button>
            ) : undefined
          }
        >
          Nobody let you in before the request timed out. You can ask again.
        </GuestMessageScreen>
      );
    default:
      return (
        <GuestMessageScreen icon="phone-hangup" title="The call has ended for you">
          Thanks for joining. You can close this page.
        </GuestMessageScreen>
      );
  }
}

function WaitingScreen({
  name,
  client,
  sessionToken,
  onFinished,
}: GuestSessionProps & { readonly name: string }) {
  return (
    <GuestMessageScreen
      icon="clock"
      title="Waiting to be let in"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            void client
              .mutation(api.guestCalls.leave, { sessionToken })
              .catch(() => undefined)
              .finally(onFinished);
          }}
        >
          Cancel
        </Button>
      }
    >
      <span role="status">
        {name.length > 0 ? `${name}, someone` : "Someone"} in the call will let you in shortly. Keep
        this page open.
      </span>
    </GuestMessageScreen>
  );
}

function InCall(
  props: GuestSessionProps & {
    readonly selfKey: string;
    readonly callId: string;
    readonly onCallEnded: () => void;
  },
) {
  const { data: publicConfig } = usePublicIce(props.client);
  const engine = useGuestEngine({
    client: props.client,
    convexUrl: props.convexUrl,
    sessionToken: props.sessionToken,
    selfKey: props.selfKey,
    callId: props.callId,
    choices: props.choices,
    iceServers: publicConfig,
    onEnded: props.onCallEnded,
  });
  if (engine === null) {
    return null;
  }
  return (
    <GuestCallView
      engine={engine}
      client={props.client}
      sessionToken={props.sessionToken}
      selfKey={props.selfKey}
      title={props.title}
      onLeave={() => {
        void engine.leave().finally(props.onFinished);
      }}
    />
  );
}

/** The workspace's public STUN/relay overrides, read without an identity. */
function usePublicIce(_client: ConvexReactClient): { readonly data: readonly RTCIceServer[] } {
  const config = useQuery(api.server.publicConfig, {});
  return { data: (config?.voice?.iceServers ?? []) as readonly RTCIceServer[] };
}
