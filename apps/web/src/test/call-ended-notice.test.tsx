import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallEndedNotice } from "../components/voice/CallEndedNotice";

const state = vi.hoisted(() => ({
  notice: null as { kind: "alone-timeout"; timeoutSeconds: number | null } | null,
  dismiss: vi.fn(),
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => ({ endedNotice: state.notice, dismissEndedNotice: state.dismiss }),
}));

beforeEach(() => {
  state.notice = null;
  state.dismiss.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CallEndedNotice", () => {
  it("explains the solo-call disconnect with the configured duration", () => {
    state.notice = { kind: "alone-timeout", timeoutSeconds: 300 };
    render(<CallEndedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You were disconnected because you were alone in the call for 5 minutes.",
    );
  });

  it("does not invent a duration an older backend did not report", () => {
    state.notice = { kind: "alone-timeout", timeoutSeconds: null };
    render(<CallEndedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You were disconnected because you were alone in the call for a while.",
    );
  });

  it("can be dismissed", async () => {
    state.notice = { kind: "alone-timeout", timeoutSeconds: 300 };
    const user = userEvent.setup();
    render(<CallEndedNotice />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses itself after a few seconds", () => {
    vi.useFakeTimers();
    state.notice = { kind: "alone-timeout", timeoutSeconds: 300 };
    render(<CallEndedNotice />);
    expect(state.dismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not stack when the same end is reported repeatedly", () => {
    state.notice = { kind: "alone-timeout", timeoutSeconds: 300 };
    const { rerender } = render(<CallEndedNotice />);
    rerender(<CallEndedNotice />);
    state.notice = { kind: "alone-timeout", timeoutSeconds: 300 };
    rerender(<CallEndedNotice />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("renders nothing when there is no notice", () => {
    render(<CallEndedNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
