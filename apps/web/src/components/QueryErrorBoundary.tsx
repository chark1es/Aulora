/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { classifyError, type ErrorDisposition } from "@aulora/core";
import { Button, Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { Component, type ReactNode, useCallback, useEffect, useState } from "react";

/**
 * How often an errored subtree is re-mounted to retry in place. Convex keeps
 * its queries subscribed, so a fresh mount usually renders the recovered data;
 * the timer covers an auth refresh that does not change the connection state.
 */
export const RETRY_INTERVAL_MS = 4_000;

/**
 * How many automatic retries a transient error gets before the boundary stops
 * and hands the choice back to the person.
 */
export const MAX_AUTO_RETRIES = 5;

export interface QueryErrorBoundaryProps {
  readonly client: ConvexReactClient;
  /** Signs the person out to reach the sign-in screen. */
  readonly onSignOut: () => void;
  /** Leaves for a different server; offered once automatic retries run out. */
  readonly onSwitchServer?: () => void;
  readonly children: ReactNode;
}

/**
 * Keeps a Convex/query failure from taking over the app. A connectivity or
 * not-yet-authenticated error shows a lightweight "Reconnecting…" state and
 * re-mounts the subtree once the connection or auth returns, giving up after
 * {@link MAX_AUTO_RETRIES} attempts so the person can retry or leave; any other
 * error offers an explicit "Try again". The signed-in shell stays mounted, so
 * the stored session is never cleared here.
 */
export function QueryErrorBoundary({
  client,
  onSignOut,
  onSwitchServer,
  children,
}: QueryErrorBoundaryProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    // Convex re-sends queries after it reconnects; re-mounting lets them be
    // observed again. The timer covers failures it does not retry on its own.
    const unsubscribe = client.subscribeToConnectionState((state) => {
      if (state.isWebSocketConnected) {
        retry();
      }
    });
    const timer = setInterval(retry, RETRY_INTERVAL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [client, retry]);

  return (
    <QueryBoundary attempt={attempt} onSignOut={onSignOut} onSwitchServer={onSwitchServer}>
      {children}
    </QueryBoundary>
  );
}

interface QueryBoundaryProps {
  readonly attempt: number;
  readonly onSignOut: () => void;
  readonly onSwitchServer: (() => void) | undefined;
  readonly children: ReactNode;
}

interface QueryBoundaryState {
  readonly error: unknown;
  /** Automatic retries are spent; waiting on the person to choose. */
  readonly exhausted: boolean;
}

class QueryBoundary extends Component<QueryBoundaryProps, QueryBoundaryState> {
  override state: QueryBoundaryState = { error: null, exhausted: false };

  /** Automatic retries since the subtree last rendered cleanly. */
  private failedRetries = 0;

  static getDerivedStateFromError(error: unknown): Partial<QueryBoundaryState> {
    return { error };
  }

  override componentDidUpdate(
    previous: QueryBoundaryProps,
    previousState: QueryBoundaryState,
  ): void {
    if (this.state.error === null) {
      if (previousState.error !== null) {
        this.failedRetries = 0;
      }
      return;
    }
    // Only a transient error recovers on its own; a fatal one waits for the
    // explicit retry so it cannot loop.
    if (
      previous.attempt === this.props.attempt ||
      this.state.exhausted ||
      classifyError(this.state.error) !== "reconnecting"
    ) {
      return;
    }
    this.failedRetries += 1;
    if (this.failedRetries >= MAX_AUTO_RETRIES) {
      this.setState({ exhausted: true });
      return;
    }
    this.setState({ error: null });
  }

  private readonly retry = (): void => {
    this.failedRetries = 0;
    this.setState({ error: null, exhausted: false });
  };

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <ErrorRecovery
        disposition={classifyError(this.state.error)}
        exhausted={this.state.exhausted}
        onRetry={this.retry}
        onSignOut={this.props.onSignOut}
        onSwitchServer={this.props.onSwitchServer}
      />
    );
  }
}

function ErrorRecovery({
  disposition,
  exhausted,
  onRetry,
  onSignOut,
  onSwitchServer,
}: {
  readonly disposition: ErrorDisposition;
  readonly exhausted: boolean;
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
  readonly onSwitchServer: (() => void) | undefined;
}) {
  const reconnecting = disposition === "reconnecting" && !exhausted;
  let title = "Something went wrong";
  let description = "This view could not load. Try again, or sign out to use a different account.";
  if (reconnecting) {
    title = "Reconnecting…";
    description = "You’re still signed in. This view will pick up where it left off.";
  } else if (exhausted) {
    title = "Can’t reach the server";
    description =
      "Reconnecting is taking too long. You’re still signed in; try again, switch servers, or sign out.";
  }
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {reconnecting && <Spinner size={28} label="Reconnecting" />}
      <Text size="md" className="font-medium">
        {title}
      </Text>
      <Text tone="muted" size="sm">
        {description}
      </Text>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="md" onClick={onRetry}>
          Try again
        </Button>
        {exhausted && onSwitchServer !== undefined && (
          <Button size="md" variant="secondary" onClick={onSwitchServer}>
            Switch server
          </Button>
        )}
        <Button size="md" variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
