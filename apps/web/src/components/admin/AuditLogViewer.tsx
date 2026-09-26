import { Button, Heading, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { describeAuditAction } from "../../lib/audit-format";

export interface AuditLogViewerProps {
  readonly canViewAuditLog: boolean;
  readonly memberNames?: ReadonlyMap<string, string>;
}

const PAGE_SIZE = 50;

/** Paginated, newest-first audit log. Server-gated by `ViewAuditLog`. */
export function AuditLogViewer({ canViewAuditLog, memberNames }: AuditLogViewerProps) {
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

  return (
    <div className="flex flex-col gap-3" data-testid="audit-log">
      <Heading level={3}>Audit log</Heading>
      {rows.length === 0 ? (
        <Text tone="muted" size="sm">
          Nothing recorded yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-input border border-border bg-surface-2 px-3 py-2"
              data-testid="audit-row"
            >
              <div className="min-w-0">
                <Text size="sm">{describeAuditAction(row.action, row.meta)}</Text>
                <Text size="xs" tone="muted" mono className="truncate">
                  {memberNames?.get(row.actorId) ?? row.actorId}
                  {row.targetId !== null ? ` → ${row.targetId}` : ""}
                </Text>
              </div>
              <Text size="xs" tone="muted" mono className="shrink-0">
                {new Date(row.at).toLocaleString()}
              </Text>
            </li>
          ))}
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
