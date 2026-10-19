/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { classifyError, type ErrorDisposition } from "@aulora/core";
import { Button, Spinner, Text } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { Component, type ReactNode, useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";

/**
 * How often an errored subtree is re-mounted to retry in place. Convex keeps
 * its queries subscribed, so a fresh mount usually renders the recovered data;
 * the timer covers an auth refresh that does not change the connection state.
 */
export const RETRY_INTERVAL_MS = 4_000;

export interface QueryErrorBoundaryProps {
  readonly client: ConvexReactClient;
  /** Signs the person out to reach the sign-in screen. */
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

/**
 * Keeps a Convex/query failure from taking over the app. A connectivity or
 * not-yet-authenticated error shows a lightweight "Reconnecting…" state and
 * re-mounts the subtree once the connection or auth returns; any other error
 * offers an explicit "Try again". The signed-in shell stays mounted, so the
 * stored session is never cleared here.
 */
export function QueryErrorBoundary({ client, onSignOut, children }: QueryErrorBoundaryProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    // Convex re-sends queries after it reconnects; re-mounting lets them be
    // observed again. The timer covers failures it does not retry on its own,
    // and only runs while the app is in the foreground.
    const unsubscribe = client.subscribeToConnectionState((state) => {
      if (state.isWebSocketConnected) {
        retry();
      }
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(retry, RETRY_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    if (AppState.currentState === "active") {
      start();
    }
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        retry();
        start();
      } else {
        // Pause the retry ticker while backgrounded.
        stop();
      }
    });
    return () => {
      unsubscribe();
      stop();
      foreground.remove();
    };
  }, [client, retry]);

  return (
    <QueryBoundary attempt={attempt} onSignOut={onSignOut}>
      {children}
    </QueryBoundary>
  );
}

interface QueryBoundaryProps {
  readonly attempt: number;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

interface QueryBoundaryState {
  readonly error: unknown;
}

class QueryBoundary extends Component<QueryBoundaryProps, QueryBoundaryState> {
  override state: QueryBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): QueryBoundaryState {
    return { error };
  }

  override componentDidUpdate(previous: QueryBoundaryProps): void {
    // Only a transient error recovers on its own; a fatal one waits for the
    // explicit retry so it cannot loop.
    if (
      previous.attempt !== this.props.attempt &&
      this.state.error !== null &&
      classifyError(this.state.error) === "reconnecting"
    ) {
      this.setState({ error: null });
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <ErrorRecovery
        disposition={classifyError(this.state.error)}
        onRetry={this.retry}
        onSignOut={this.props.onSignOut}
      />
    );
  }
}

function ErrorRecovery({
  disposition,
  onRetry,
  onSignOut,
}: {
  readonly disposition: ErrorDisposition;
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  const reconnecting = disposition === "reconnecting";
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      {reconnecting && <Spinner size={28} label="Reconnecting" />}
      <Text size="md" className="text-center font-medium">
        {reconnecting ? "Reconnecting…" : "Something went wrong"}
      </Text>
      <Text size="sm" tone="muted" className="text-center">
        {reconnecting
          ? "You’re still signed in. This view will pick up where it left off."
          : "This view could not load. Try again, or sign out to use a different account."}
      </Text>
      <Button onPress={onRetry}>Try again</Button>
      <Button variant="ghost" onPress={onSignOut}>
        Sign out
      </Button>
    </View>
  );
}
