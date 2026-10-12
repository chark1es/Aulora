import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionRecoveryActions } from "../components/ConnectionRecoveryActions";
import { STUCK_TIMEOUT_MS, useStuckTimeout } from "../lib/use-stuck-timeout";

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useStuckTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips after the timeout and clears when the wait ends", () => {
    const { result, rerender } = renderHook(
      ({ waiting }: { readonly waiting: boolean }) => useStuckTimeout(waiting),
      { initialProps: { waiting: true } },
    );

    expect(result.current).toBe(false);
    advance(STUCK_TIMEOUT_MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);

    rerender({ waiting: false });
    expect(result.current).toBe(false);
  });

  it("restarts the countdown when the reset signal changes", () => {
    const { result, rerender } = renderHook(
      ({ reset }: { readonly reset: number }) => useStuckTimeout(true, reset),
      { initialProps: { reset: 0 } },
    );

    advance(STUCK_TIMEOUT_MS - 1);
    expect(result.current).toBe(false);

    rerender({ reset: 1 });
    advance(STUCK_TIMEOUT_MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it("does not flip once the wait has ended", () => {
    const { result, rerender } = renderHook(
      ({ waiting }: { readonly waiting: boolean }) => useStuckTimeout(waiting),
      { initialProps: { waiting: true } },
    );

    rerender({ waiting: false });
    advance(STUCK_TIMEOUT_MS * 2);
    expect(result.current).toBe(false);
  });
});

describe("ConnectionRecoveryActions", () => {
  it("offers retry and switch, but not removal without a saved server", () => {
    render(<ConnectionRecoveryActions onRetry={() => {}} onSwitchServer={() => {}} />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a different server" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove this server" })).not.toBeInTheDocument();
  });

  it("calls the retry and switch handlers", () => {
    const onRetry = vi.fn();
    const onSwitchServer = vi.fn();
    render(<ConnectionRecoveryActions onRetry={onRetry} onSwitchServer={onSwitchServer} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Use a different server" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSwitchServer).toHaveBeenCalledTimes(1);
  });

  it("confirms before removing a saved server", () => {
    const onRemoveServer = vi.fn();
    render(
      <ConnectionRecoveryActions
        serverName="Acme"
        canRemoveServer
        onRetry={() => {}}
        onSwitchServer={() => {}}
        onRemoveServer={onRemoveServer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove this server" }));
    expect(onRemoveServer).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove server" }));
    expect(onRemoveServer).toHaveBeenCalledTimes(1);
  });

  it("does not remove when the confirmation is cancelled", () => {
    const onRemoveServer = vi.fn();
    render(
      <ConnectionRecoveryActions
        canRemoveServer
        onRetry={() => {}}
        onSwitchServer={() => {}}
        onRemoveServer={onRemoveServer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove this server" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemoveServer).not.toHaveBeenCalled();
  });

  it("hides removal when no removal handler is provided", () => {
    render(
      <ConnectionRecoveryActions canRemoveServer onRetry={() => {}} onSwitchServer={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Remove this server" })).not.toBeInTheDocument();
  });
});
