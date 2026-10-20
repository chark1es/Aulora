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
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Please try again.";
}
