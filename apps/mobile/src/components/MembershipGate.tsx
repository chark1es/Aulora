import { Spinner } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { JoinGate } from "./JoinGate";

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
  const me = useQuery(api.members.me, {});
  if (me === undefined) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner size={28} label="Loading workspace" />
      </View>
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
