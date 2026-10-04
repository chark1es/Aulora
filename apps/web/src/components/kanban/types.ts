import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../packages/convex/convex/_generated/api";
export type Board = FunctionReturnType<typeof api.kanban.listBoards>[number];
export type Card = FunctionReturnType<typeof api.kanban.listCards>[number];
export interface BoardMember {
  userId: string;
  displayName: string;
}
export function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not save. Try again.";
}
export const control =
  "w-full rounded-input border border-border bg-surface-3 px-3 py-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

/** getRandomValues also works for local HTTP deployments on the LAN. */
export function newItemId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
