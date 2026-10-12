/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { InviteKind } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Button, ConfirmDialog, cn, Icon, SegmentedControl, Text } from "@aulora/ui-web";
import { type ReactNode, useState } from "react";
import {
  expiryLabel,
  formatDate,
  type InviteStatus,
  kindLabel,
  statusLabel,
  usesLabel,
} from "../../../lib/invite-format";

export interface InviteRedemption {
  readonly userId: string;
  readonly name: string | null;
  readonly at: number;
}

export interface InviteRow {
  readonly id: string;
  readonly kind: InviteKind;
  readonly status: InviteStatus;
  readonly createdByName: string | null;
  readonly createdBy: string;
  readonly note: string | null;
  readonly codeHint: string | null;
  readonly restrictedEmail: string | null;
  readonly emailStatus: "queued" | "sent" | "failed" | null;
  readonly maxUses: number;
  readonly uses: number;
  readonly expiresAt: number | null;
  readonly createdAt: number;
  readonly redemptions: readonly InviteRedemption[];
}

const KIND_ICONS = new Map<InviteKind, IconName>([
  ["link", "link"],
  ["email", "mail"],
  ["code", "key"],
]);

const STATUS_STYLES = new Map<InviteStatus, string>([
  ["active", "bg-accent-soft text-accent"],
  ["revoked", "bg-danger/10 text-danger"],
  ["expired", "bg-surface-3 text-text-muted"],
  ["exhausted", "bg-surface-3 text-text-muted"],
]);

type Filter = "active" | "ended" | "all";

interface PendingAction {
  readonly id: string;
  readonly action: "revoke" | "delete";
}

function matches(filter: Filter, status: InviteStatus): boolean {
  if (filter === "all") {
    return true;
  }
  return filter === "active" ? status === "active" : status !== "active";
}

export interface InviteListProps {
  readonly rows: readonly InviteRow[];
  readonly canDelete: boolean;
  readonly canLoadMore: boolean;
  readonly onLoadMore: () => void;
  readonly onRevoke: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

/** The invite history: who made each one, how, its limits, and who joined. */
export function InviteList(props: InviteListProps) {
  const { rows, canDelete, canLoadMore, onLoadMore, onRevoke, onDelete } = props;
  const [filter, setFilter] = useState<Filter>("active");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const visible = rows.filter((row) => matches(filter, row.status));

  return (
    <section className="flex flex-col gap-3" aria-label="Invite history">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-text">History</span>
        <SegmentedControl
          label="Filter invites"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Active" },
            { value: "ended", label: "Ended" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface-2">
        {visible.map((invite) => (
          <InviteItem
            key={invite.id}
            invite={invite}
            canDelete={canDelete}
            onRevoke={() => {
              setPending({ id: invite.id, action: "revoke" });
            }}
            onDelete={() => {
              setPending({ id: invite.id, action: "delete" });
            }}
          />
        ))}
        {visible.length === 0 && (
          <li className="px-4 py-5 text-center">
            <Text tone="muted" size="sm">
              {filter === "active" ? "No active invites." : "Nothing here yet."}
            </Text>
          </li>
        )}
      </ul>

      {canLoadMore && (
        <Button variant="ghost" size="sm" className="self-center" onClick={onLoadMore}>
          Load older invites
        </Button>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
        }}
        title={pending?.action === "delete" ? "Delete this invite?" : "Revoke this invite?"}
        description={
          pending?.action === "delete"
            ? "It is removed from this list along with its join history. The audit log keeps a record."
            : "The link or code stops working right away. People who already joined stay."
        }
        confirmLabel={pending?.action === "delete" ? "Delete" : "Revoke"}
        variant="danger"
        onConfirm={() => {
          if (pending?.action === "delete") {
            onDelete(pending.id);
          } else if (pending !== null) {
            onRevoke(pending.id);
          }
          setPending(null);
        }}
      />
    </section>
  );
}

function StatusBadge({ status }: { readonly status: InviteStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES.get(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

interface MetaProps {
  readonly children: ReactNode;
}

function Meta({ children }: MetaProps) {
  return <span className="whitespace-nowrap">{children}</span>;
}

function joinedLine(redemptions: readonly InviteRedemption[], uses: number): string | null {
  if (uses === 0) {
    return null;
  }
  const names = redemptions.slice(0, 3).map((join) => join.name ?? "A member");
  const extra = uses - names.length;
  return `Joined: ${names.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`;
}

interface InviteItemProps {
  readonly invite: InviteRow;
  readonly canDelete: boolean;
  readonly onRevoke: () => void;
  readonly onDelete: () => void;
}

function InviteItem({ invite, canDelete, onRevoke, onDelete }: InviteItemProps) {
  const now = Date.now();
  const joined = joinedLine(invite.redemptions, invite.uses);
  const active = invite.status === "active";
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-testid="invite-row">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-text-muted">
        <Icon name={KIND_ICONS.get(invite.kind) ?? "link"} size={15} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text">
            {kindLabel(invite.kind)} invite
            {invite.codeHint !== null && (
              <span className="ml-1.5 font-mono text-[11px] font-normal text-text-muted">
                …{invite.codeHint}
              </span>
            )}
          </span>
          <StatusBadge status={invite.status} />
        </div>
        {invite.note !== null && (
          <span className="truncate text-[12px] text-text-secondary">{invite.note}</span>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-muted">
          <Meta>By {invite.createdByName ?? "a former member"}</Meta>
          <Meta>{formatDate(invite.createdAt)}</Meta>
          <Meta>{expiryLabel(invite.expiresAt, now)}</Meta>
          <Meta>{usesLabel(invite.uses, invite.maxUses)}</Meta>
          {invite.restrictedEmail !== null && <Meta>For {invite.restrictedEmail}</Meta>}
          {invite.emailStatus === "failed" && (
            <span className="font-medium text-danger">Email failed to send</span>
          )}
        </div>
        {joined !== null && <span className="truncate text-[12px] text-text-muted">{joined}</span>}
      </div>
      {canDelete && (
        <div className="flex shrink-0 items-center gap-1">
          {active && (
            <Button type="button" variant="ghost" size="sm" onClick={onRevoke}>
              Revoke
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label="Delete invite"
          >
            <Icon name="trash" size={14} />
          </Button>
        </div>
      )}
    </li>
  );
}
