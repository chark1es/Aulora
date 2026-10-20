import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryErrorBoundary, RETRY_INTERVAL_MS } from "../components/QueryErrorBoundary";

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
