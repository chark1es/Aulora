import { ALL_PERMISSIONS, type ChannelSummary } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { ChatProvider } from "../../providers/ChatProvider";
import { ChatView } from "./ChatView";

const PAGE = { numItems: 100, cursor: null } as const;

export interface ChatSessionShellProps {
  readonly client: ConvexReactClient;
  readonly workspaceName: string;
  readonly user: { readonly id: string; readonly name?: string; readonly email?: string };
  readonly onSignOut: () => void;
}

/**
 * Loads the workspace's channels through Convex, then hands them to the
 * encrypted {@link ChatView}. Channel metadata arrives as ciphertext and is
 * only decrypted inside the MLS session.
 */
export function ChatSessionShell({ client, workspaceName, user }: ChatSessionShellProps) {
  const channelResult = useQuery(api.channels.list, { paginationOpts: PAGE });
  const dmResult = useQuery(api.channels.listDms, { paginationOpts: PAGE });

  const channels = useMemo<readonly ChannelSummary[]>(() => {
    const list: ChannelSummary[] = [];
    for (const channel of channelResult?.page ?? []) {
      list.push(channel as ChannelSummary);
    }
    for (const channel of dmResult?.page ?? []) {
      list.push(channel as ChannelSummary);
    }
    return list;
  }, [channelResult, dmResult]);

  const members = useMemo(
    () => [{ userId: user.id, displayName: user.name ?? user.email ?? "You", isOwner: true }],
    [user.id, user.name, user.email],
  );

  if (channelResult === undefined) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Loading workspace" />
        <Text tone="muted" size="sm">
          Loading workspace…
        </Text>
      </div>
    );
  }

  return (
    <ChatProvider
      client={client}
      userId={user.id}
      displayName={user.name ?? user.email ?? "You"}
      channels={channels}
    >
      <ChatView
        workspaceName={workspaceName}
        ownUserId={user.id}
        permissions={ALL_PERMISSIONS}
        members={members}
        roles={[]}
      />
    </ChatProvider>
  );
}
