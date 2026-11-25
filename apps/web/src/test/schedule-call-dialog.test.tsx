import { Permission } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleCallDialog } from "../components/scheduled/ScheduleCallDialog";

const state = vi.hoisted(() => ({
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) {
      state.mutations.set(name, vi.fn().mockResolvedValue("new-id"));
    }
    return state.mutations.get(name);
  },
}));

const channels = [{ id: "ch1", kind: "voice", name: "Lounge" }];

function open(editing: Parameters<typeof ScheduleCallDialog>[0]["editing"]) {
  return render(
    <ScheduleCallDialog
      editing={editing}
      ownUserId="u1"
      permissions={Permission.ScheduleCalls}
      guestCallsEnabled={false}
      members={[{ userId: "u2", displayName: "Rae" }]}
      roles={[]}
      channels={channels as never}
      titles={new Map([["ch1", "Lounge"]])}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.mutations.clear();
});

describe("ScheduleCallDialog invite-only option", () => {
  it("reveals the invitee picker only for a channel call that is invite only", async () => {
    const user = userEvent.setup();
    open(null);
    // Standalone rooms always show the picker and have no toggle.
    expect(screen.queryByRole("checkbox", { name: /Invite only/u })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "In a channel" }));
    const toggle = screen.getByRole("checkbox", { name: /Invite only/u });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("Search roles and people")).toBeNull();
    await user.click(toggle);
    expect(screen.getByLabelText("Search roles and people")).toBeInTheDocument();
  });

  it("edits an open call without tripping the start-in-the-future check", async () => {
    const startsAt = Math.floor((Date.now() - 10 * 60_000) / 60_000) * 60_000;
    const user = userEvent.setup();
    open({
      id: "sc1",
      title: "Running",
      description: "",
      startsAt,
      durationMinutes: 30,
      openLeadMinutes: 5,
      channelId: "ch1",
      inviteeUserIds: [],
      inviteeRoleIds: [],
      inviteOnly: false,
      status: "open",
    });
    expect(screen.getByTestId("schedule-open-note")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(state.mutations.get("scheduledCalls:update")).toHaveBeenCalled();
    });
    expect(screen.queryByText(/start time in the future/u)).toBeNull();
  });
});
