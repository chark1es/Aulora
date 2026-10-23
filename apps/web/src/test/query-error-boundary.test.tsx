import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AUTO_RETRIES,
  QueryErrorBoundary,
  RETRY_INTERVAL_MS,
} from "../components/QueryErrorBoundary";

/** Only the connection subscription is exercised; the rest of the client is unused. */
function stubClient(): ConvexReactClient {
  return {
    subscribeToConnectionState: () => () => undefined,
  } as unknown as ConvexReactClient;
}

let shouldThrow = true;
let thrown: Error = new Error("Not authenticated");

function Flaky() {
  if (shouldThrow) {
    throw thrown;
  }
  return <div>Recovered</div>;
}

describe("QueryErrorBoundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shouldThrow = true;
    thrown = new Error("Not authenticated");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows reconnecting and recovers on its own for a transient error", () => {
    const onSignOut = vi.fn();
    render(
      <QueryErrorBoundary client={stubClient()} onSignOut={onSignOut}>
        <Flaky />
      </QueryErrorBoundary>,
    );

    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    // A transient failure must never sign the person out.
    expect(onSignOut).not.toHaveBeenCalled();

    shouldThrow = false;
    act(() => {
      vi.advanceTimersByTime(RETRY_INTERVAL_MS);
    });
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("stops retrying after the limit and offers switch, retry and sign out", () => {
    const onSwitchServer = vi.fn();
    render(
      <QueryErrorBoundary client={stubClient()} onSignOut={vi.fn()} onSwitchServer={onSwitchServer}>
        <Flaky />
      </QueryErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: "Switch server" })).not.toBeInTheDocument();

    // One act per tick: React batches updates made inside a single act.
    for (let tick = 0; tick < MAX_AUTO_RETRIES; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(RETRY_INTERVAL_MS);
      });
    }
    expect(screen.getByText("Can’t reach the server")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();

    // Once spent, the timer no longer re-mounts the subtree on its own.
    shouldThrow = false;
    act(() => {
      vi.advanceTimersByTime(RETRY_INTERVAL_MS * 3);
    });
    expect(screen.queryByText("Recovered")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
    expect(onSwitchServer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("offers a working try-again for a fatal error and never auto-recovers", () => {
    thrown = new Error("Invalid arguments for this query");
    const onSignOut = vi.fn();
    render(
      <QueryErrorBoundary client={stubClient()} onSignOut={onSignOut}>
        <Flaky />
      </QueryErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();

    // The retry timer does not fire for a fatal error.
    shouldThrow = false;
    act(() => {
      vi.advanceTimersByTime(RETRY_INTERVAL_MS * 2);
    });
    expect(screen.queryByText("Recovered")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("signs out only when the person asks", () => {
    const onSignOut = vi.fn();
    render(
      <QueryErrorBoundary client={stubClient()} onSignOut={onSignOut}>
        <Flaky />
      </QueryErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
