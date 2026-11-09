/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  addonFlagsOf,
  type ChannelSummary,
  type RoleMentionTarget,
  resolveFeatureFlags,
} from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { selectEagerChannelIds } from "../../lib/channel-priority";
import { useRemountLog } from "../../lib/remount-debug";
import { useLastDefined } from "../../lib/use-last-defined";
import { useStuckTimeout } from "../../lib/use-stuck-timeout";
import {
  type CategoryView,
  heldRoleIds,
  memberDisplayName,
  type RoleView,
  resolveViewerPermissions,
  roleRef,
  topPositionForRefs,
} from "../../lib/workspace-admin";
import { ChatProvider } from "../../providers/ChatProvider";
import { type VoicePolicy, VoiceProvider } from "../../providers/VoiceProvider";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "../ConnectionRecoveryActions";
import type { ChannelUnread } from "./ChannelSidebar";
import { ChatView } from "./ChatView";

const PAGE = { numItems: 100, cursor: null } as const;

/** Recovery actions passed down to the initial-load spinner. */
export type ChatSessionShellRecovery = ConnectionRecoveryActionsProps;

export interface ChatSessionShellProps {
  readonly client: ConvexReactClient;
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly user: { readonly id: string; readonly name?: string; readonly email?: string };
  readonly onSignOut: () => void;
  /** Retry / switch / remove actions shown when the first load stalls. */
  readonly recovery?: ChatSessionShellRecovery;
}

/**
 * Loads the workspace's channels, roles, the caller's own membership and
 * permissions, then hands them to {@link ChatView}. Channel metadata arrives
 * as plaintext; the server seals it at rest. Admin controls are gated by the
 * resolved bitfield; the server re-checks.
 *
 * The full member directory is deliberately not subscribed here: names, role
 * colors and mention targets are resolved for the ids a view displays
 * (`members.brief`), the member panel pages (`members.page`) and mention
 * autocomplete searches (`members.search`). A workspace member list is not a
 * per-message dependency, so it must not be an always-on subscription.
 */
export function ChatSessionShell({
  client,
  workspaceName,
  workspaceIconSeed,
  user,
  onSignOut,
  recovery,
}: ChatSessionShellProps) {
  useRemountLog("ChatSessionShell");
  const channelResult = useLastDefined(useQuery(api.channels.list, { paginationOpts: PAGE }));
  const dmResult = useLastDefined(useQuery(api.channels.listDms, { paginationOpts: PAGE }));
  const rolesResult = useLastDefined(useQuery(api.roles.list, {}));
  const categoriesResult = useLastDefined(useQuery(api.categories.list, {}));
  // Keep the last answer across a reconnect: a momentarily missing membership
  // must not swap the whole chat surface for the loading spinner.
  const meResult = useLastDefined(useQuery(api.members.me, {}));
  const publicConfig = useLastDefined(useQuery(api.server.publicConfig, {}));

  const voicePolicy = useMemo<VoicePolicy>(() => {
    const voice = publicConfig?.voice;
    return {
      enabled: voice?.enabled ?? true,
      videoEnabled: voice?.videoEnabled ?? true,
      screenShareEnabled: voice?.screenShareEnabled ?? true,
      maxParticipants: voice?.maxParticipants ?? 10,
      iceServers: (voice?.iceServers ?? []) as readonly RTCIceServer[],
    };
  }, [publicConfig]);

  const voiceFlags = useMemo(() => resolveFeatureFlags(publicConfig?.features), [publicConfig]);
  const addonFlags = useMemo(() => addonFlagsOf(publicConfig?.addons), [publicConfig]);

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

  const channelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const summaryResult = useQuery(
    api.readStates.summary,
    channelIds.length > 0 ? { channelIds: channelIds as never[] } : "skip",
  );
  const unreadByChannel = useMemo(() => {
    const map = new Map<string, ChannelUnread>();
    for (const row of summaryResult ?? []) {
      map.set(row.channelId, {
        unread: row.unread,
        unreadCount: row.unreadCount,
        mentionCount: row.mentionCount,
        lastActivityAt: row.lastActivityAt,
      });
    }
    return map;
  }, [summaryResult]);

  const roles = (rolesResult ?? []) as readonly RoleView[];
  const categories = (categoriesResult ?? []) as readonly CategoryView[];

  // The only message streams opened eagerly: the highlighted (unread/mention)
  // conversations plus a small fill. The open channel is served separately by
  // `useChannelSession`, so it never needs to be in this set.
  const eagerChannelIds = useMemo(
    () => selectEagerChannelIds(channels, unreadByChannel),
    [channels, unreadByChannel],
  );
  const viewerMember = meResult?.member ?? null;
  const ownName = memberDisplayName(viewerMember, user.name ?? user.email ?? "You");
  const isOwner = meResult?.isOwner ?? false;
  const ownerIds =
    meResult?.ownerIds ??
    (meResult?.ownerId !== undefined && meResult.ownerId !== null ? [meResult.ownerId] : []);
  // Owner management is absent on a backend from before multiple owners; do
  // not offer a control that the old deployment cannot serve during rollout.
  const ownerManagementAvailable = meResult?.ownerIds !== undefined;

  const viewerRoleIds = useMemo(() => heldRoleIds(viewerMember, roles), [viewerMember, roles]);
  const permissions = useMemo(
    () =>
      resolveViewerPermissions({
        viewer: { userId: user.id, isOwner },
        member: viewerMember,
        roles,
      }),
    [user.id, isOwner, viewerMember, roles],
  );
  const topPosition = isOwner ? Number.POSITIVE_INFINITY : topPositionForRefs(viewerRoleIds, roles);

  // The server expands `@role` mentions from the role id (see
  // `messages.send`), so the shell no longer needs every member's roles here.
  const mentionRoles = useMemo<readonly RoleMentionTarget[]>(
    () =>
      roles.map((role) => ({
        roleId: roleRef(role),
        name: role.name,
        mentionable: role.mentionable && !role.isEveryone,
        memberUserIds: [],
      })),
    [roles],
  );

  const isLoading = channelResult === undefined || meResult === undefined;
  const stuck = useStuckTimeout(isLoading);

  if (isLoading) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Spinner size={28} label="Loading workspace" />
        <Text tone="muted" size="sm">
          Loading {workspaceName}…
        </Text>
        {stuck && recovery !== undefined && (
          <>
            <Text tone="muted" size="sm">
              This is taking longer than usual.
            </Text>
            <ConnectionRecoveryActions {...recovery} />
          </>
        )}
      </div>
    );
  }

  return (
    <ChatProvider
      client={client}
      userId={user.id}
      displayName={ownName}
      channels={channels}
      eagerChannelIds={eagerChannelIds}
    >
      <VoiceProvider
        client={client}
        userId={user.id}
        permissions={permissions}
        policy={voicePolicy}
        featureFlags={voiceFlags}
        addons={addonFlags}
      >
        <ChatView
          workspaceName={workspaceName}
          workspaceIconSeed={workspaceIconSeed}
          ownUserId={user.id}
          ownName={ownName}
          ownAvatarUrl={viewerMember?.avatarUrl ?? null}
          unreadByChannel={unreadByChannel}
          onSignOut={onSignOut}
          permissions={permissions}
          kanbanEnabled={publicConfig?.addons.kanban ?? false}
          notesEnabled={publicConfig?.addons.notes ?? false}
          roles={mentionRoles}
          admin={{
            viewer: {
              userId: user.id,
              isOwner,
              roleIds: viewerRoleIds,
              permissions,
              topPosition,
            },
            ownerIds,
            ownerManagementAvailable,
            roleViews: roles,
            categories,
          }}
        />
      </VoiceProvider>
    </ChatProvider>
  );
}
