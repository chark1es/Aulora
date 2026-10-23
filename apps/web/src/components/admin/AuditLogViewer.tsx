import type { IconName } from "@aulora/tokens";
import { Button, EmptyState, Icon, Spinner, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type AuditCategory,
  auditCategory,
  formatAuditEvent,
  shortId,
} from "../../lib/audit-format";
import { AdminPageHeader } from "./AdminPageHeader";

export interface AuditLogViewerProps {
  readonly canViewAuditLog: boolean;
  readonly memberNames?: ReadonlyMap<string, string>;
  readonly roleNames?: ReadonlyMap<string, string>;
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly categoryNames?: ReadonlyMap<string, string>;
}

const PAGE_SIZE = 50;

const CATEGORY_ICON = new Map<AuditCategory, IconName>([
  ["role", "shield"],
  ["member", "users"],
  ["category", "sidebar"],
  ["channel", "hash"],
  ["server", "settings"],
  ["other", "file"],
]);

/** A compact "2h ago"-style age for a timestamp. */
function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(at).toLocaleDateString();
}

/**
 * Paginated, newest-first audit log rendered as a compact single-line feed.
 * Actors and targets are resolved to display names wherever a lookup is known;
 * opaque ids are shortened rather than spilled. Server-gated by `ViewAuditLog`.
 */
export function AuditLogViewer({
  canViewAuditLog,
  memberNames,
  roleNames,
  channelNames,
  categoryNames,
}: AuditLogViewerProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(
    api.auditLog.list,
    canViewAuditLog ? { paginationOpts: { numItems: PAGE_SIZE, cursor } } : "skip",
  );

  if (!canViewAuditLog) {
    return (
      <div className="flex flex-col gap-8" data-testid="audit-locked">
        <AdminPageHeader
          title="Audit log"
          description="Recent admin activity across this workspace."
        />
        <Text tone="muted" size="sm">
          You need the View audit log permission to read the audit log.
        </Text>
      </div>
    );
  }

  const rows = result?.page ?? [];
  const now = Date.now();

  function resolveTarget(targetId: string | null): string | null {
    if (targetId === null) {
      return null;
    }
    return (
      memberNames?.get(targetId) ??
      roleNames?.get(targetId) ??
      channelNames?.get(targetId) ??
      categoryNames?.get(targetId) ??
      null
    );
  }

  return (
    <div className="flex flex-col gap-8" data-testid="audit-log">
      <AdminPageHeader
        title="Audit log"
        description="Recent admin activity across this workspace."
      />

      {result === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading audit log" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon="file"
          title="Nothing recorded yet"
          description="Admin actions appear here as they happen."
        />
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {rows.map((row) => {
            const category = auditCategory(row.action);
            const actor = row.actorName || memberNames?.get(row.actorId) || shortId(row.actorId);
            const target = row.targetName || resolveTarget(row.targetId) || null;
            return (
              <li
                key={row.id}
                data-testid="audit-row"
                className="flex min-h-[44px] items-center gap-2.5 px-4 py-2 transition hover:bg-surface-3/40"
              >
                <Icon
                  name={CATEGORY_ICON.get(category) ?? "file"}
                  size={14}
                  className="shrink-0 text-text-muted"
                />
                <div className="min-w-0 flex-1">
                  <Text size="sm" className="truncate">
                    {formatAuditEvent(row.action, row.meta, {
                      actorName: actor,
                      targetName: target,
                    })}
                  </Text>
                </div>
                <Text
                  size="xs"
                  tone="muted"
                  className="shrink-0 text-right tabular-nums"
                  title={new Date(row.at).toLocaleString()}
                >
                  {relativeTime(row.at, now)}
                </Text>
              </li>
            );
          })}
        </ul>
      )}

      {result !== undefined && !result.isDone && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setCursor(result.continueCursor);
            }}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
