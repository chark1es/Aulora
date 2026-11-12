import type { IconName } from "@aulora/tokens";
import type { AuditCategory } from "../../lib/audit-format";

/** The icon used for each audit category in the feed and the detail dialog. */
export const AUDIT_CATEGORY_ICON: ReadonlyMap<AuditCategory, IconName> = new Map([
  ["role", "shield"],
  ["member", "users"],
  ["invite", "mail"],
  ["message", "message"],
  ["category", "sidebar"],
  ["channel", "hash"],
  ["kanban", "kanban"],
  ["notes", "note"],
  ["call", "phone"],
  ["bot", "code"],
  ["server", "settings"],
  ["other", "file"],
]);
