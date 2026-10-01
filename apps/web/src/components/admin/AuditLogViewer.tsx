import type { IconName } from "@aulora/tokens";
import { Button, Heading, Icon, Spinner, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type AuditCategory,
  auditCategory,
  formatAuditEvent,
  shortId,
} from "../../lib/audit-format";

export interface AuditLogViewerProps {
  readonly canViewAuditLog: boolean;
  readonly memberNames?: ReadonlyMap<string, string>;
  readonly roleNames?: ReadonlyMap<string, string>;
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly categoryNames?: ReadonlyMap<string, string>;
}

const PAGE_SIZE = 50;

const CATEGORY_ICON: Record<AuditCategory, IconName> = {
  role: "shield",
  member: "users",
  category: "sidebar",
  channel: "hash",
  server: "settings",
  other: "file",
};

const CATEGORY_ACCENT: Record<AuditCategory, string> = {
  role: "bg-accent-soft text-accent",
  member: "bg-secondary/10 text-secondary",
  category: "bg-surface-3 text-text-muted",
  channel: "bg-accent-soft text-accent",
  server: "bg-surface-3 text-text-muted",
  other: "bg-surface-3 text-text-muted",
};

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
      <Text tone="muted" size="sm" data-testid="audit-locked">
        You need the View audit log permission to read the audit log.
      </Text>
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
    <div className="flex flex-col gap-3" data-testid="audit-log">
      <header className="flex flex-col gap-1">
        <Heading level={3}>Audit log</Heading>
        <Text size="sm" tone="muted">
          Recent admin activity across this workspace.
        </Text>
      </header>

      {result === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading audit log" />
        </div>
      ) : rows.length === 0 ? (
        <Text tone="muted" size="sm">
          Nothing recorded yet.
        </Text>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-surface-2">
          {rows.map((row) => {
            const category = auditCategory(row.action);
            const actor = row.actorName || memberNames?.get(row.actorId) || shortId(row.actorId);
            const target = row.targetName || resolveTarget(row.targetId) || null;
            return (
              <li
                key={row.id}
                data-testid="audit-row"
                className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-surface-3/50"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${CATEGORY_ACCENT[category]}`}
                >
                  <Icon name={CATEGORY_ICON[category]} size={14} />
                </span>
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
          <Button size="sm" variant="secondary" onClick={() => setCursor(result.continueCursor)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
