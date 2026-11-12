import { recordDebugFailure, userFacingError } from "@aulora/core";

export interface ChatScreenProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly onSignOut: () => void | Promise<void>;
  /** Permanently deletes the signed-in account. */
  readonly onDeleteAccount: () => void | Promise<void>;
}

export type Nullable<T> = T | null;

export function errorMessage(error: unknown): string {
  // A caught action failure that only becomes an alert would otherwise leave
  // the debug report empty, exactly like a session with no problem.
  recordDebugFailure("ui.action", error);
  return userFacingError(error);
}
