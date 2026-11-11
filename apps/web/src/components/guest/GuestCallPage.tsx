import { ConvexProvider, type ConvexReactClient, useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { guestClientId } from "../../lib/guest/client-id";
import { classifyJoinFailure, type JoinFailure } from "../../lib/guest/page-state";
import {
  clearGuestSession,
  readGuestSession,
  writeGuestSession,
} from "../../lib/guest/session-store";
import { DEFAULT_GUEST_CHOICES, type GuestMediaChoices } from "./DeviceCheck";
import { GuestErrorBoundary } from "./GuestErrorBoundary";
import { GuestJoinForm, type JoinSubmission } from "./GuestJoinForm";
import { GuestMessageScreen } from "./GuestMessageScreen";
import { GuestSession } from "./GuestSession";

function Unavailable() {
  return (
    <GuestMessageScreen icon="link" title="This guest link isn’t available">
      It may have expired, been replaced or used up. Ask the person who invited you for a new link.
    </GuestMessageScreen>
  );
}

function SessionGone() {
  return (
    <GuestMessageScreen icon="phone-hangup" title="This visit has ended">
      Thanks for joining. If you meant to stay, ask the person who invited you for a new link.
    </GuestMessageScreen>
  );
}

export interface GuestCallPageProps {
  readonly client: ConvexReactClient;
  readonly convexUrl: string;
  /** The link token read from the address bar, or `null` when there was none. */
  readonly linkToken: string | null;
}

/**
 * The guest’s whole visit: the lobby form while there is only a link, then the
 * session once they have asked to join. Outside the signed-in shell, with no
 * account and no Convex identity: the link token and then the session token are
 * the only credentials, and every failure to use either reads as one message.
 */
export function GuestCallPage(props: GuestCallPageProps) {
  return (
    <ConvexProvider client={props.client}>
      <GuestFlow {...props} />
    </ConvexProvider>
  );
}

function GuestFlow({ client, convexUrl, linkToken }: GuestCallPageProps) {
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => readGuestSession()?.sessionToken ?? null,
  );
  const [choices, setChoices] = useState<GuestMediaChoices>(DEFAULT_GUEST_CHOICES);
  const [title, setTitle] = useState("Guest call");
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const requestJoin = useMutation(api.guestCalls.requestJoin);

  const finish = useCallback(() => {
    clearGuestSession();
    // Keep the screen: it explains how the visit ended. Only the credential goes.
  }, []);

  const submit = useCallback(
    (submission: JoinSubmission) => {
      if (linkToken === null || busy) {
        return;
      }
      setBusy(true);
      setFailure(null);
      void requestJoin({
        token: linkToken,
        displayName: submission.displayName,
        ...(submission.affiliation.length > 0 ? { affiliation: submission.affiliation } : {}),
        clientId: guestClientId(),
      })
        .then((result) => {
          writeGuestSession({ sessionToken: result.sessionToken });
          setSessionToken(result.sessionToken);
        })
        .catch((error: unknown) => {
          setFailure(classifyJoinFailure(error));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [linkToken, busy, requestJoin],
  );

  if (sessionToken !== null) {
    return (
      <GuestErrorBoundary fallback={SessionGone}>
        <GuestSession
          client={client}
          convexUrl={convexUrl}
          sessionToken={sessionToken}
          title={title}
          choices={choices}
          onFinished={finish}
          onAskAgain={
            linkToken === null
              ? null
              : () => {
                  clearGuestSession();
                  setSessionToken(null);
                  setFailure(null);
                }
          }
        />
      </GuestErrorBoundary>
    );
  }

  if (linkToken === null || failure?.kind === "unavailable") {
    return <Unavailable />;
  }

  return (
    <GuestErrorBoundary fallback={Unavailable}>
      <GuestJoinForm
        linkToken={linkToken}
        choices={choices}
        onChoices={setChoices}
        busy={busy}
        failure={failure}
        onTitle={setTitle}
        onSubmit={submit}
      />
    </GuestErrorBoundary>
  );
}
