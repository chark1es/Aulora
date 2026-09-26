import type { MutationCtx } from "../_generated/server";

export interface AuditEntry {
  readonly actorId: string;
  readonly action: string;
  readonly targetId?: string;
  /** Optional opaque JSON string. Never put message plaintext or keys here. */
  readonly meta?: string;
  readonly at?: number;
}

/**
 * Appends a row to `auditLog`. Phase 2 records message deletes, pin changes and
 * channel changes; the full role editor and a viewer arrive in Phase 3.
 */
export async function writeAudit(ctx: MutationCtx, entry: AuditEntry): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: entry.actorId,
    action: entry.action,
    ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
    ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
    at: entry.at ?? Date.now(),
  });
}
