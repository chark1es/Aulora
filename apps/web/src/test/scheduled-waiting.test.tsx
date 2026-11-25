import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScheduledWaitingPrompt,
  ScheduledWaitingWatcher,
} from "../components/scheduled/ScheduledWaiting";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  voice: {} as Record<string, unknown>,
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) {
      state.mutations.set(name, vi.fn().mockResolvedValue(undefined));
    }
    return state.mutations.get(name);
  },
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => state.voice,
}));

function row(overrides: Record<string, unknown>) {
  return {
    id: "w1",
    scheduledCallId: "sc1",
    title: "Weekly sync",
    kind: "early",
    state: "waiting",
    callStatus: "open",
    opensAt: Date.now() - 1_000,
    startsAt: Date.now() + 60_000,
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.voice = {
    call: null,
    joinScheduledCall: vi.fn().mockResolvedValue({ ok: true }),
    reportError: vi.fn(),
  };
});

describe("ScheduledWaitingWatcher", () => {
  it("joins an early arrival once the call has opened, exactly once", async () => {
    state.values.set("scheduledCalls:mine", [row({})]);
    const { rerender } = render(<ScheduledWaitingWatcher />);
    await waitFor(() => {
      expect(state.voice.joinScheduledCall).toHaveBeenCalledWith("sc1", "Weekly sync");
    });
    rerender(<ScheduledWaitingWatcher />);
    expect(state.voice.joinScheduledCall).toHaveBeenCalledTimes(1);
  });

  it("joins a member a host admitted, and waits while the call is not open yet", async () => {
    state.values.set("scheduledCalls:mine", [
      row({ kind: "early", callStatus: "scheduled", opensAt: Date.now() + 3_600_000 }),
    ]);
    const { unmount } = render(<ScheduledWaitingWatcher />);
    expect(state.voice.joinScheduledCall).not.toHaveBeenCalled();
    unmount();
    state.values.set("scheduledCalls:mine", [
      row({ kind: "knock", state: "admitted", callStatus: "scheduled" }),
    ]);
    render(<ScheduledWaitingWatcher />);
    await waitFor(() => {
      expect(state.voice.joinScheduledCall).toHaveBeenCalledTimes(1);
    });
  });

  it("never pulls a member out of a call they are already in", () => {
    state.voice.call = { id: "other" };
    state.values.set("scheduledCalls:mine", [row({})]);
    render(<ScheduledWaitingWatcher />);
    expect(state.voice.joinScheduledCall).not.toHaveBeenCalled();
  });

  it("reports a refused join and clears the waiting row", async () => {
    state.voice.joinScheduledCall = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "This call is invite-only" });
    state.values.set("scheduledCalls:mine", [row({})]);
    render(<ScheduledWaitingWatcher />);
    await waitFor(() => {
      expect(state.voice.reportError).toHaveBeenCalledWith("This call is invite-only");
    });
    await waitFor(() => {
      expect(state.mutations.get("scheduledCalls:leave")).toHaveBeenCalledWith({
        scheduledCallId: "sc1",
      });
    });
  });
});

describe("ScheduledWaitingPrompt", () => {
  const expiresAt = Date.now() + 600_000;
  const waiting = {
    waiting: [
      { id: "r1", userId: "u5", displayName: "Rae", kind: "knock", requestedAt: 1, expiresAt },
    ],
  };

  it("renders nothing for a call that is not scheduled or for a non-host", () => {
    state.values.set("scheduledCalls:waitingList", waiting);
    state.voice.call = { id: "c1", scheduledCallId: null };
    const { container, unmount } = render(<ScheduledWaitingPrompt />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    state.voice.call = { id: "c1", scheduledCallId: "sc1" };
    state.values.set("scheduledCalls:waitingAccess", { canManage: false });
    const second = render(<ScheduledWaitingPrompt />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("lets a host admit or decline the people waiting in the call", async () => {
    state.voice.call = { id: "c1", scheduledCallId: "sc1" };
    state.values.set("scheduledCalls:waitingAccess", { canManage: true });
    state.values.set("scheduledCalls:waitingList", waiting);
    const user = userEvent.setup();
    render(<ScheduledWaitingPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("1 person is waiting");
    expect(screen.getByText("Asking to join")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Admit Rae" }));
    expect(state.mutations.get("scheduledCalls:admit")).toHaveBeenCalledWith({ waitingId: "r1" });
    await user.click(screen.getByRole("button", { name: "Decline Rae" }));
    expect(state.mutations.get("scheduledCalls:decline")).toHaveBeenCalledWith({ waitingId: "r1" });
  });
});
