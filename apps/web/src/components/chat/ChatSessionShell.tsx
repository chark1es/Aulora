import type { ChannelSummary, RoleMentionTarget } from "@aulora/core";
import { Spinner } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type CategoryView,
  heldRoleIds,
  type MemberView,
  memberDisplayName,
  type RoleView,
  resolveViewerPermissions,
  roleColorFor,
  roleNamesFor,
  roleRef,
  topPositionForRefs,
} from "../../lib/workspace-admin";
import { ChatProvider } from "../../providers/ChatProvider";
import { type VoicePolicy, VoiceProvider } from "../../providers/VoiceProvider";
import type { ChannelUnread } from "./ChannelSidebar";
import { ChatView } from "./ChatView";
import { MemberAvatarProvider } from "./member-avatars";

const PAGE = { numItems: 100, cursor: null } as const;

export interface ChatSessionShellProps {
  readonly client: ConvexReactClient;
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly user: { readonly id: string; readonly name?: string; readonly email?: string };
  readonly onSignOut: () => void;
}

/**
 * Loads the workspace's channels, roles, members and the caller's own
 * permissions, then hands them to {@link ChatView}. Channel metadata arrives
 * as plaintext; the server seals it at rest. Admin controls are gated by the
 * resolved bitfield; the server re-checks.
 */
export function ChatSessionShell({
  client,
  workspaceName,
  workspaceIconSeed,
  user,
  onSignOut,
}: ChatSessionShellProps) {
  const channelResult = useQuery(api.channels.list, { paginationOpts: PAGE });
  const dmResult = useQuery(api.channels.listDms, { paginationOpts: PAGE });
  const rolesResult = useQuery(api.roles.list, {});
  const membersResult = useQuery(api.members.list, {});
  const categoriesResult = useQuery(api.categories.list, {});
  const meResult = useQuery(api.members.me, {});
  const publicConfig = useQuery(api.server.publicConfig, {});

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
        mentionCount: row.mentionCount,
        lastActivityAt: row.lastActivityAt,
      });
    }
    return map;
  }, [summaryResult]);

  const roles = (rolesResult ?? []) as readonly RoleView[];
  const memberViews = (membersResult ?? []) as readonly MemberView[];
  const categories = (categoriesResult ?? []) as readonly CategoryView[];
  const viewerMember = meResult?.member ?? null;
  const ownName = memberDisplayName(viewerMember, user.name ?? user.email ?? "You");
  const isOwner = meResult?.isOwner ?? false;
  const ownerId = meResult?.ownerId ?? null;

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

  const members = useMemo(
    () =>
      memberViews.map((member) => ({
        userId: member.userId,
        displayName: memberDisplayName(
          member,
          member.userId === user.id ? (user.name ?? user.email ?? "You") : "Member",
        ),
        roleIds: member.roleIds,
        roleNames: roleNamesFor(member, roles),
        isOwner: member.userId === ownerId,
        roleColor: roleColorFor(member, roles),
      })),
    [memberViews, roles, ownerId, user.id, user.name, user.email],
  );

  const mentionRoles = useMemo<readonly RoleMentionTarget[]>(
    () =>
      roles.map((role) => {
        const ref = roleRef(role);
        return {
          roleId: ref,
          name: role.name,
          mentionable: role.mentionable,
          memberUserIds: memberViews
            .filter((member) => member.roleIds.includes(ref))
            .map((member) => member.userId),
        };
      }),
    [roles, memberViews],
  );

  if (channelResult === undefined || meResult === undefined) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Loading workspace" />
        <p className="text-[13px] text-text-muted">Loading {workspaceName}…</p>
      </div>
    );
  }

  return (
    <MemberAvatarProvider members={memberViews}>
      <ChatProvider client={client} userId={user.id} displayName={ownName} channels={channels}>
        <VoiceProvider
          client={client}
          userId={user.id}
          permissions={permissions}
          policy={voicePolicy}
        >
          <ChatView
            workspaceName={workspaceName}
            workspaceIconSeed={workspaceIconSeed}
            ownUserId={user.id}
            ownName={ownName}
            unreadByChannel={unreadByChannel}
            onSignOut={onSignOut}
            permissions={permissions}
            kanbanEnabled={publicConfig?.addons.kanban ?? false}
            members={members}
            roles={mentionRoles}
            admin={{
              viewer: {
                userId: user.id,
                isOwner,
                roleIds: viewerRoleIds,
                permissions,
                topPosition,
              },
              ownerId,
              roleViews: roles,
              memberViews,
              categories,
            }}
          />
        </VoiceProvider>
      </ChatProvider>
    </MemberAvatarProvider>
  );
}
