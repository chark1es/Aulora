import { classifyError } from "@aulora/core";
import { Button, Text } from "@aulora/ui-web";
import type { ErrorComponentProps } from "@tanstack/react-router";

/**
 * Recoverable fallback for an error that escapes the session's own boundary.
 * TanStack Router's built-in error component is a dead end; this one always
 * offers a working reset, and treats a transient failure as reconnecting.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const reconnecting = classifyError(error) === "reconnecting";
  return (
    <div className="pane flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Text size="md" className="font-medium">
        {reconnecting ? "Reconnecting…" : "Something went wrong"}
      </Text>
      <Text tone="muted" size="sm">
        {reconnecting
          ? "Check your connection, then try again."
          : "This view could not load. Try again to reload it."}
      </Text>
      <Button size="md" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
