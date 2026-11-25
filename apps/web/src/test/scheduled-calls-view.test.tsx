import { DEFAULT_VOICE_SETTINGS, Permission } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledCallsView } from "../components/scheduled/ScheduledCallsView";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  join: vi.fn(),
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
  useVoice: () => ({
    canConnect: true,
    policy: { enabled: true },
    joinScheduledCall: state.join,
    settings: DEFAULT_VOICE_SETTINGS,
  }),
}));

const HOUR = 3_600_000;

function call(overrides: Record<string, unknown>) {
  const startsAt = Date.now() + 2 * HOUR;
  return {
    id: "sc1",
    title: "Weekly sync",
    description: "",
    startsAt,
    durationMinutes: 30,
    openLeadMinutes: 5,
    opensAt: startsAt - 5 * 60_000,
    channelId: null,
    inviteeUserIds: ["u2"],
    inviteeRoleIds: [],
    createdBy: "u1",
    status: "scheduled",
    callId: null,
    canManage: false,
    canJoin: true,
    ...overrides,
  };
}

function view(permissions: bigint = Permission.ViewScheduledCalls) {
  return render(
    <ScheduledCallsView
      ownUserId="u1"
      permissions={permissions}
      members={[]}
      roles={[]}
      channels={[]}
      titles={new Map()}
      guestCallsEnabled={false}
      onBack={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.join.mockReset();
});

describe("ScheduledCallsView", () => {
  it("shows a loading state, then an empty state with no schedule action for a viewer", () => {
    view();
    expect(screen.getByLabelText("Loading scheduled calls")).toBeInTheDocument();
    state.values.set("scheduledCalls:list", []);
    view();
    expect(screen.getByText("No scheduled calls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule a call" })).toBeNull();
  });

  it("offers scheduling to someone who may, and names the viewer's time zone", () => {
    state.values.set("scheduledCalls:list", []);
    view(Permission.ViewScheduledCalls | Permission.ScheduleCalls);
    expect(screen.getByRole("button", { name: "Schedule a call" })).toBeInTheDocument();
    expect(screen.getByTestId("scheduled-zone")).toHaveTextContent(/^Times in .+\(.+\)$/u);
  });

  it("disables Join before the open time and says when it opens", () => {
    state.values.set("scheduledCalls:list", [call({})]);
    view();
    const row = screen.getByTestId("scheduled-call-sc1");
    expect(within(row).getByRole("button", { name: "Join" })).toBeDisabled();
    const hint = within(row).getByTestId("scheduled-not-open");
    expect(hint).toHaveTextContent("This call hasn’t started yet. It opens at");
    expect(hint).toHaveTextContent(/in 1 h|in 2 h/u);
    expect(within(row).getByRole("button", { name: "Join" })).toHaveAttribute(
      "aria-describedby",
      hint.id,
    );
  });

  it("lets an administrator join early and explains why", async () => {
    state.join.mockResolvedValue({ ok: true });
    state.values.set("scheduledCalls:list", [call({ canJoinEarly: true })]);
    const user = userEvent.setup();
    view();
    const row = screen.getByTestId("scheduled-call-sc1");
    const join = within(row).getByRole("button", { name: "Join early" });
    expect(join).toBeEnabled();
    expect(within(row).getByTestId("scheduled-not-open")).toHaveTextContent(
      "As an administrator, you can join now.",
    );
    await user.click(join);
    expect(state.join).toHaveBeenCalledWith("sc1", "Weekly sync");
  });

  it("enables Join inside the open window and joins through the voice provider", async () => {
    const startsAt = Date.now() + 2 * 60_000;
    state.join.mockResolvedValue({ ok: true });
    state.values.set("scheduledCalls:list", [call({ startsAt, opensAt: startsAt - 5 * 60_000 })]);
    const user = userEvent.setup();
    view();
    const join = screen.getByRole("button", { name: "Join" });
    expect(join).toBeEnabled();
    await user.click(join);
    expect(state.join).toHaveBeenCalledWith("sc1", "Weekly sync");
  });

  it("shows the server's not-open refusal as the same message with the local time", async () => {
    const startsAt = Date.now() + 2 * 60_000;
    state.join.mockResolvedValue({
      ok: false,
      message: "This call hasn’t started yet. It opens at 3:25 PM EST",
      notOpen: { startsAt, opensAt: startsAt - 60_000 },
    });
    state.values.set("scheduledCalls:list", [call({ startsAt, opensAt: startsAt - 5 * 60_000 })]);
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This call hasn’t started yet. It opens at 3:25 PM EST",
    );
  });

  it("hides edit and cancel unless the server says the viewer manages the call", () => {
    state.values.set("scheduledCalls:list", [
      call({ id: "mine", title: "Mine", canManage: true }),
      call({ id: "theirs", title: "Theirs", canManage: false }),
    ]);
    view();
    expect(screen.getByRole("button", { name: "Edit Mine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Mine" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Theirs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel Theirs" })).toBeNull();
  });

  it("drops a bot invitee from an existing call when it is saved", async () => {
    state.values.set("scheduledCalls:list", [
      call({ id: "mine", title: "Mine", canManage: true, inviteeUserIds: ["u2", "bot_helper"] }),
    ]);
    const user = userEvent.setup();
    view(Permission.ViewScheduledCalls | Permission.ScheduleCalls);
    await user.click(screen.getByRole("button", { name: "Edit Mine" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(state.mutations.get("scheduledCalls:update")).toHaveBeenCalledWith(
        expect.objectContaining({ inviteeUserIds: ["u2"] }),
      );
    });
  });

  it("cancels only after confirmation", async () => {
    state.values.set("scheduledCalls:list", [call({ canManage: true })]);
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Cancel Weekly sync" }));
    expect(state.mutations.get("scheduledCalls:cancel")).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Cancel call" }));
    await waitFor(() => {
      expect(state.mutations.get("scheduledCalls:cancel")).toHaveBeenCalledWith({
        scheduledCallId: "sc1",
      });
    });
  });

  it("keeps cancelled and past calls out of Upcoming, behind a Past toggle", async () => {
    state.values.set("scheduledCalls:list", [
      call({ id: "gone", title: "Cancelled one", status: "cancelled" }),
    ]);
    const user = userEvent.setup();
    view();
    expect(screen.queryByText("Cancelled one")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Past \(1\)/u }));
    expect(screen.getByText("Cancelled one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  describe("waiting room", () => {
    function waitingRow(overrides: Record<string, unknown>) {
      const opensAt = Date.now() + 115 * 60_000;
      return {
        id: "w1",
        scheduledCallId: "sc1",
        title: "Weekly sync",
        kind: "early",
        state: "waiting",
        callStatus: "scheduled",
        opensAt,
        startsAt: opensAt + 5 * 60_000,
        expiresAt: Date.now() + 3_600_000,
        ...overrides,
      };
    }

    it("offers Wait to join to an invited member before the open time", async () => {
      const enter = vi.fn().mockResolvedValue({ state: "waiting", kind: "early" });
      state.mutations.set("scheduledCalls:enter", enter);
      state.values.set("scheduledCalls:list", [call({ invited: true, inviteOnly: true })]);
      const user = userEvent.setup();
      view();
      const row = screen.getByTestId("scheduled-call-sc1");
      expect(within(row).queryByRole("button", { name: "Join" })).toBeNull();
      await user.click(within(row).getByRole("button", { name: "Wait to join" }));
      expect(enter).toHaveBeenCalledWith({ scheduledCallId: "sc1" });
      expect(state.join).not.toHaveBeenCalled();
    });

    it("joins directly when the server says the member can already join", async () => {
      state.join.mockResolvedValue({ ok: true });
      state.mutations.set("scheduledCalls:enter", vi.fn().mockResolvedValue({ state: "join" }));
      state.values.set("scheduledCalls:list", [call({ invited: true })]);
      const user = userEvent.setup();
      view();
      await user.click(screen.getByRole("button", { name: "Wait to join" }));
      await waitFor(() => {
        expect(state.join).toHaveBeenCalledWith("sc1", "Weekly sync");
      });
    });

    it("shows the automatic-join promise and lets the member leave", async () => {
      state.values.set("scheduledCalls:list", [call({ invited: true })]);
      state.values.set("scheduledCalls:mine", [waitingRow({})]);
      const user = userEvent.setup();
      view();
      const row = screen.getByTestId("scheduled-call-sc1");
      expect(within(row).getByTestId("scheduled-waiting-status")).toHaveTextContent(
        /You’ll join automatically when it opens at/u,
      );
      await user.click(within(row).getByRole("button", { name: "Leave" }));
      expect(state.mutations.get("scheduledCalls:leave")).toHaveBeenCalledWith({
        scheduledCallId: "sc1",
      });
    });

    it("offers Ask to join on an invite-only call the member is not on, and shows the wait", () => {
      state.values.set("scheduledCalls:list", [
        call({ channelId: "ch1", inviteOnly: true, invited: false, status: "open" }),
      ]);
      const { unmount } = view();
      expect(screen.getByRole("button", { name: "Ask to join" })).toBeEnabled();
      unmount();
      state.values.set("scheduledCalls:mine", [waitingRow({ kind: "knock" })]);
      view();
      expect(screen.getByTestId("scheduled-waiting-status")).toHaveTextContent(
        "Waiting for a host to let you in",
      );
    });

    it("tells a declined member and keeps the admin's Join early", () => {
      state.values.set("scheduledCalls:list", [
        call({ channelId: "ch1", inviteOnly: true, invited: false }),
      ]);
      state.values.set("scheduledCalls:mine", [waitingRow({ kind: "knock", state: "declined" })]);
      const { unmount } = view();
      expect(screen.getByTestId("scheduled-waiting-status")).toHaveTextContent(
        "A host declined your request",
      );
      unmount();
      state.values.clear();
      state.values.set("scheduledCalls:list", [
        call({ canJoinEarly: true, invited: true, inviteOnly: true }),
      ]);
      view();
      expect(screen.getByRole("button", { name: "Join early" })).toBeEnabled();
    });

    it("offers Join to a member a host admitted", () => {
      state.values.set("scheduledCalls:list", [
        call({ channelId: "ch1", inviteOnly: true, invited: false, status: "open" }),
      ]);
      state.values.set("scheduledCalls:mine", [
        waitingRow({ kind: "knock", state: "admitted", callStatus: "open" }),
      ]);
      view();
      expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
    });

    it("lets a host admit, decline and let everyone in from the row", async () => {
      const startsAt = Date.now() + 2 * 60_000;
      state.values.set("scheduledCalls:list", [
        call({
          startsAt,
          opensAt: startsAt - 5 * 60_000,
          canManage: true,
          canManageWaiting: true,
          invited: true,
        }),
      ]);
      const expiresAt = Date.now() + 600_000;
      state.values.set("scheduledCalls:waitingList", {
        waiting: [
          { id: "r1", userId: "u5", displayName: "Rae", kind: "early", requestedAt: 1, expiresAt },
          { id: "r2", userId: "u6", displayName: "Sam", kind: "early", requestedAt: 2, expiresAt },
          { id: "r3", userId: "u7", displayName: "Tia", kind: "knock", requestedAt: 3, expiresAt },
        ],
      });
      const user = userEvent.setup();
      view();
      const panel = screen.getByTestId("scheduled-waiting-sc1");
      expect(within(panel).getByRole("status")).toHaveTextContent("3 people are waiting");
      await user.click(within(panel).getByRole("button", { name: "Let in Rae" }));
      expect(state.mutations.get("scheduledCalls:admit")).toHaveBeenCalledWith({ waitingId: "r1" });
      await user.click(within(panel).getByRole("button", { name: "Decline Tia" }));
      expect(state.mutations.get("scheduledCalls:decline")).toHaveBeenCalledWith({
        waitingId: "r3",
      });
      await user.click(within(panel).getByRole("button", { name: "Let everyone in" }));
      expect(state.mutations.get("scheduledCalls:admitAllEarly")).toHaveBeenCalledWith({
        scheduledCallId: "sc1",
      });
    });

    it("does not subscribe to the waiting list for a viewer who cannot manage it", () => {
      state.values.set("scheduledCalls:list", [call({ canManageWaiting: false })]);
      state.values.set("scheduledCalls:waitingList", { waiting: [] });
      view();
      expect(screen.queryByTestId("scheduled-waiting-sc1")).toBeNull();
    });
  });
});
