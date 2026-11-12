import { Spinner } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { useLastDefined } from "../lib/last-defined";
import { JoinGate } from "./JoinGate";
import { ScreenContainer } from "./layout/ScreenContainer";

export interface MembershipGateProps {
  readonly workspaceIconSeed: string;
  readonly signedInAs: string | null;
  readonly onSignOut: () => void;
  readonly onDeleteAccount: () => void | Promise<void>;
  readonly children: ReactNode;
}

/**
 * Keeps the chat surface behind membership. An account that signed in but is
 * neither a member nor the owner sees the join screen; chat replaces it as soon
 * as their membership exists.
 */
export function MembershipGate({
  workspaceIconSeed,
  signedInAs,
  onSignOut,
  onDeleteAccount,
  children,
}: MembershipGateProps) {
  const me = useLastDefined(useQuery(api.members.me, {}));
  if (me === undefined) {
    return (
      <ScreenContainer scrollable className="flex-1 items-center justify-center min-w-0">
        <Spinner size={28} label="Loading workspace" />
      </ScreenContainer>
    );
  }
  if (me.member === null && !me.isOwner) {
    return (
      <JoinGate
        workspaceIconSeed={workspaceIconSeed}
        signedInAs={signedInAs}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
      />
    );
  }
  return <>{children}</>;
}
