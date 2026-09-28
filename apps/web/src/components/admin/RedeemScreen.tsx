import type { ServerProfile } from "@aulora/core";
import { Button, Card, Heading, Spinner, Text } from "@aulora/ui-web";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient, useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type AuloraAuthClient,
  authActionsFromClient,
  createAuloraAuthClient,
} from "../../lib/auth-client";
import { redeemErrorMessage } from "../../lib/invites";
import { AuthFrame } from "../AuthFrame";
import { SignInScreen } from "../SignInScreen";

export interface RedeemCardProps {
  readonly code: string;
  readonly state: "idle" | "pending" | "done";
  readonly message: string | null;
  readonly error: string | null;
  readonly onJoin: () => void;
  readonly onContinue: () => void;
}

/** Presentational redeem card: join, retry, or continue after success. */
export function RedeemCard({ state, message, error, onJoin, onContinue }: RedeemCardProps) {
  return (
    <AuthFrame>
      <Card
        className="flex flex-col gap-4 rounded-[12px] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_30px_-16px_rgba(0,0,0,0.25)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-20px_rgba(0,0,0,0.85)]"
        data-testid="redeem-card"
      >
        <Heading level={2}>Join workspace</Heading>
        {state === "done" ? (
          <>
            <Text tone="secondary" size="sm" role="status">
              {message ?? "You are in."}
            </Text>
            <Button onClick={onContinue}>Go to the workspace</Button>
          </>
        ) : (
          <>
            <Text tone="muted" size="sm">
              Accept this invite to become a member of this workspace.
            </Text>
            {error !== null && (
              <Text tone="danger" size="sm" role="alert">
                {error}
              </Text>
            )}
            <Button loading={state === "pending"} disabled={state === "pending"} onClick={onJoin}>
              {error !== null ? "Try again" : "Join workspace"}
            </Button>
          </>
        )}
      </Card>
    </AuthFrame>
  );
}

export interface RedeemSessionProps {
  readonly profile: ServerProfile;
  readonly code: string;
  readonly onDone: () => void;
}

/** Convex + Better Auth session scoped to the redeem route. */
export function RedeemSession({ profile, code, onDone }: RedeemSessionProps) {
  const convex = useMemo(() => new ConvexReactClient(profile.convexUrl), [profile.convexUrl]);
  const authClient = useMemo(() => createAuloraAuthClient(profile.siteUrl), [profile.siteUrl]);
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <RedeemGate authClient={authClient} profile={profile} code={code} onDone={onDone} />
    </ConvexBetterAuthProvider>
  );
}

function RedeemGate({
  authClient,
  profile,
  code,
  onDone,
}: {
  readonly authClient: AuloraAuthClient;
  readonly profile: ServerProfile;
  readonly code: string;
  readonly onDone: () => void;
}) {
  const session = authClient.useSession();
  const actions = useMemo(() => authActionsFromClient(authClient), [authClient]);
  const redeem = useMutation(api.invites.redeem);

  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (session.isPending) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Checking your session" />
        <Text tone="muted" size="sm">
          Checking your session…
        </Text>
      </div>
    );
  }

  const user = session.data?.user;
  if (user === undefined || user === null) {
    return <SignInScreen profile={profile} actions={actions} />;
  }

  return (
    <RedeemCard
      code={code}
      state={state}
      message={message}
      error={error}
      onJoin={() => {
        setState("pending");
        setError(null);
        void redeem({ code })
          .then((result) => {
            setMessage(result.alreadyMember ? "You are already a member." : "Welcome aboard.");
            setState("done");
            // Give the toast a beat before navigating home.
            setTimeout(onDone, 600);
          })
          .catch((cause: unknown) => {
            setError(redeemErrorMessage(cause));
            setState("idle");
          });
      }}
      onContinue={onDone}
    />
  );
}
