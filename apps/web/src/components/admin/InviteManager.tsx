import { Icon, SegmentedControl, Spinner, Text } from "@aulora/ui-web";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { AllowlistManager } from "./invites/AllowlistManager";
import { InviteCreateForm } from "./invites/InviteCreateForm";
import { InviteList, type InviteRow } from "./invites/InviteList";
import { SettingsSectionHeader } from "./SettingsSection";

export interface InviteManagerProps {
  readonly canCreateInvites: boolean;
  readonly canDeleteInvites: boolean;
  readonly origin: string;
}

type View = "invites" | "allowlist";

const PAGE_SIZE = 25;

/**
 * Invite management: create links, emailed one-time invitations and access
 * codes, review who made each one and who joined, revoke or delete them, and
 * keep the allowlist of pre-approved addresses. Creating and deleting are
 * separate permissions; either one opens the section.
 */
export function InviteManager({ canCreateInvites, canDeleteInvites, origin }: InviteManagerProps) {
  const [view, setView] = useState<View>("invites");

  if (!canCreateInvites && !canDeleteInvites) {
    return (
      <Text tone="muted" size="sm" data-testid="invites-locked">
        You need the Create invites or Delete invites permission to manage invites.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="invite-manager">
      <SettingsSectionHeader
        icon="user-plus"
        title="Invites"
        description="Bring people in with a link, an emailed one-time invitation or a short code — or pre-approve their address."
        trailing={
          <SegmentedControl
            label="Invite section"
            value={view}
            onChange={setView}
            options={[
              { value: "invites", label: "Invites" },
              { value: "allowlist", label: "Allowlist" },
            ]}
          />
        }
      />

      {view === "invites" ? (
        <InvitesView canCreate={canCreateInvites} canDelete={canDeleteInvites} origin={origin} />
      ) : (
        <AllowlistManager canAdd={canCreateInvites} canRemove={canDeleteInvites} />
      )}
    </div>
  );
}

function InvitesView({
  canCreate,
  canDelete,
  origin,
}: {
  readonly canCreate: boolean;
  readonly canDelete: boolean;
  readonly origin: string;
}) {
  const list = usePaginatedQuery(api.invites.list, {}, { initialNumItems: PAGE_SIZE });
  const revoke = useMutation(api.invites.revoke);
  const remove = useMutation(api.invites.remove);

  return (
    <div className="flex flex-col gap-5">
      {canCreate && <InviteCreateForm origin={origin} />}

      {list.status === "LoadingFirstPage" ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading invites" />
        </div>
      ) : (
        <InviteList
          rows={list.results as readonly InviteRow[]}
          canDelete={canDelete}
          canLoadMore={list.status === "CanLoadMore"}
          onLoadMore={() => {
            list.loadMore(PAGE_SIZE);
          }}
          onRevoke={(id) => {
            void revoke({ inviteId: id as Id<"invites"> });
          }}
          onDelete={(id) => {
            void remove({ inviteId: id as Id<"invites"> });
          }}
        />
      )}
      {!canCreate && (
        <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
          <Icon name="lock" size={12} />
          You can review and delete invites, but not create them.
        </span>
      )}
    </div>
  );
}
