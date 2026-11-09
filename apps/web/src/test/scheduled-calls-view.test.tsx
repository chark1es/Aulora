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
    expect(hint).toHaveTextContent("This call hasn't started yet — opens at");
    expect(hint).toHaveTextContent(/in 1 h|in 2 h/u);
    expect(within(row).getByRole("button", { name: "Join" })).toHaveAttribute(
      "aria-describedby",
      hint.id,
    );
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
      message: "This call hasn't started yet — opens at 3:25 PM EST",
      notOpen: { startsAt, opensAt: startsAt - 60_000 },
    });
    state.values.set("scheduledCalls:list", [call({ startsAt, opensAt: startsAt - 5 * 60_000 })]);
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This call hasn't started yet — opens at 3:25 PM EST",
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
});
