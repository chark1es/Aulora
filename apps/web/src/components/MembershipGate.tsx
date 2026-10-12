import { Spinner } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { JoinGate } from "./JoinGate";

export interface MembershipGateProps {
  readonly workspaceIconSeed: string;
  readonly signedInAs: string | null;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

/**
 * Keeps the chat surface behind membership. A signed-in account that is
 * neither a member nor the owner would otherwise hit queries that refuse
 * non-members; they get the join screen instead, and chat appears the moment
 * their membership is created.
 */
export function MembershipGate({
  workspaceIconSeed,
  signedInAs,
  onSignOut,
  children,
}: MembershipGateProps) {
  const me = useQuery(api.members.me, {});
  if (me === undefined) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Loading workspace" />
      </div>
    );
  }
  if (me.member === null && !me.isOwner) {
    return (
      <JoinGate
        workspaceIconSeed={workspaceIconSeed}
        signedInAs={signedInAs}
        onSignOut={onSignOut}
      />
    );
  }
  return <>{children}</>;
}
