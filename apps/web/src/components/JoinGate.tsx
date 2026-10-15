import { Button, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { redeemErrorMessage } from "../lib/invites";
import { AuthCard, AuthFrame, AuthHeader, AuthLink } from "./AuthFrame";
import { BlobatarHero } from "./BlobatarHero";
import { AllowlistJoin } from "./join/AllowlistJoin";
import { CodeEntry } from "./join/CodeEntry";

export interface JoinGateProps {
  readonly workspaceIconSeed: string;
  readonly signedInAs: string | null;
  readonly onSignOut: () => void;
}

/**
 * Shown to a signed-in account that is not a member yet: an invite-only
 * workspace they signed up to without a link. They can enter a code, or join
 * straight away when an admin pre-approved their address.
 */
export function JoinGate({ workspaceIconSeed, signedInAs, onSignOut }: JoinGateProps) {
  const status = useQuery(api.joinAccess.status, {});
  if (status === undefined) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Checking your access" />
      </div>
    );
  }
  const subtitle = status.banned
    ? "You can’t join this workspace."
    : status.inviteOnly
      ? "This workspace is invite only. Enter your invite to continue."
      : "You’re signed in. Join to get started.";
  return (
    <AuthFrame seed={workspaceIconSeed}>
      <AuthHeader
        mark={<BlobatarHero seed={workspaceIconSeed} size={124} />}
        title={`Join ${status.workspaceName}`}
        subtitle={subtitle}
        {...(signedInAs !== null ? { caption: signedInAs } : {})}
      />
      {!status.banned && (
        <AuthCard>
          {status.allowlisted && (
            <AllowlistJoin
              emailHint={status.emailHint}
              emailVerified={status.emailVerified}
              canEmailCode={status.canEmailCode}
            />
          )}
          {status.inviteOnly ? <InviteSection afterAllowlist={status.allowlisted} /> : <OpenJoin />}
        </AuthCard>
      )}
      <AuthLink centered onClick={onSignOut}>
        Sign out
      </AuthLink>
    </AuthFrame>
  );
}

function InviteSection({ afterAllowlist }: { readonly afterAllowlist: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {afterAllowlist && (
        <p className="text-center text-xs text-text-muted">or use an invite you were given</p>
      )}
      <CodeEntry />
    </div>
  );
}

function OpenJoin() {
  const join = useMutation(api.joinAccess.joinOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <Button
        size="lg"
        loading={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void join({})
            .catch((cause: unknown) => {
              setError(redeemErrorMessage(cause));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <span className="text-[15px] font-semibold">Join workspace</span>
      </Button>
    </div>
  );
}
