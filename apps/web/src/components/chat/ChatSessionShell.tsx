import type { ChannelSummary, RoleMentionTarget } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
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
  roleRef,
  topPositionForRefs,
} from "../../lib/workspace-admin";
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
 * Loads the workspace's channels, roles, members and the caller's own
 * permissions, then hands them to the encrypted {@link ChatView}. Channel
 * metadata arrives as ciphertext and is only decrypted inside the MLS session.
 * Admin controls are gated by the resolved bitfield; the server re-checks.
 */
export function ChatSessionShell({ client, workspaceName, user }: ChatSessionShellProps) {
  const channelResult = useQuery(api.channels.list, { paginationOpts: PAGE });
  const dmResult = useQuery(api.channels.listDms, { paginationOpts: PAGE });
  const rolesResult = useQuery(api.roles.list, {});
  const membersResult = useQuery(api.members.list, {});
  const categoriesResult = useQuery(api.categories.list, {});
  const meResult = useQuery(api.members.me, {});

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

  const roles = (rolesResult ?? []) as readonly RoleView[];
  const memberViews = (membersResult ?? []) as readonly MemberView[];
  const categories = (categoriesResult ?? []) as readonly CategoryView[];
  const viewerMember = meResult?.member ?? null;
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
        displayName: memberDisplayName(member, member.userId),
        roleIds: member.roleIds,
        isOwner: member.userId === ownerId,
        roleColor: roleColorFor(member, roles),
      })),
    [memberViews, roles, ownerId],
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
        permissions={permissions}
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
    </ChatProvider>
  );
}
