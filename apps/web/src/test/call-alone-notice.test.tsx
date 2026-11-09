import { CALL_ALONE_HINT_MESSAGE } from "@aulora/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallAloneNotice } from "../components/voice/CallAloneNotice";

const state = vi.hoisted(() => ({
  deadline: null as number | null,
  stayInCall: vi.fn(),
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => ({
    call: { id: "c", kind: "voice", startedAt: 0, participants: [], aloneDeadline: state.deadline },
    stayInCall: state.stayInCall,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  state.deadline = null;
  state.stayInCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CallAloneNotice", () => {
  it("stays hidden until the last minute", () => {
    state.deadline = Date.now() + 2 * 60_000;
    const { rerender } = render(<CallAloneNotice />);
    expect(screen.queryByRole("status")).toBeNull();

    state.deadline = Date.now() + 45_000;
    rerender(<CallAloneNotice />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("0:45")).toBeInTheDocument();
    expect(screen.getByText(/nobody else is here/)).toBeInTheDocument();
  });

  it("announces the reason once as a polite live region", () => {
    state.deadline = Date.now() + 45_000;
    render(<CallAloneNotice />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(CALL_ALONE_HINT_MESSAGE);
    // A single visible region mounts, so there is nothing to stack.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps the ticking countdown out of the announcement", () => {
    state.deadline = Date.now() + 45_000;
    render(<CallAloneNotice />);

    expect(screen.getByText("0:45").closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("counts down from the server deadline", () => {
    state.deadline = Date.now() + 45_000;
    render(<CallAloneNotice />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("0:40")).toBeInTheDocument();
  });

  it("resets the window when Stay is chosen", () => {
    state.deadline = Date.now() + 30_000;
    render(<CallAloneNotice />);

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(state.stayInCall).toHaveBeenCalledTimes(1);
  });

  it("hides itself once the deadline has passed", () => {
    state.deadline = Date.now() + 1_000;
    const { rerender } = render(<CallAloneNotice />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    rerender(<CallAloneNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing without a deadline, as an older backend reports", () => {
    render(<CallAloneNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
