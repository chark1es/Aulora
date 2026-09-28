import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditChannelModal } from "../components/chat/EditChannelModal";

const members = [
  { userId: "me", displayName: "Me" },
  { userId: "u-ada", displayName: "Ada Lovelace" },
  { userId: "u-bob", displayName: "Bob Stone" },
];

function baseProps() {
  return {
    open: true,
    channelName: "general",
    channelTopic: "old topic",
    isPrivate: false,
    initialMemberIds: [],
    initialBlockedUserIds: [],
    ownUserId: "me",
    members,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };
}

describe("EditChannelModal", () => {
  it("saves the edited name, topic, privacy, members and blocked users", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditChannelModal {...baseProps()} onSave={onSave} />);

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "renamed");

    const topic = screen.getByLabelText("Topic");
    await user.clear(topic);
    await user.type(topic, "new topic");

    await user.click(screen.getByRole("switch", { name: "Private channel" }));

    const modal = screen.getByTestId("edit-channel-modal");
    await user.click(within(modal).getByTestId("member-option-u-ada"));
    await user.click(within(modal).getByTestId("blocked-option-u-bob"));

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "renamed",
      topic: "new topic",
      private: true,
      memberIds: ["me", "u-ada"],
      blockedUserIds: ["u-bob"],
    });
  });

  it("adds and removes blocked users through the chips and list", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditChannelModal {...baseProps()} initialBlockedUserIds={["u-bob"]} onSave={onSave} />);

    expect(screen.getByTestId("blocked-chip-u-bob")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unblock Bob Stone" }));
    expect(screen.queryByTestId("blocked-chip-u-bob")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("blocked-option-u-ada"));
    expect(screen.getByTestId("blocked-chip-u-ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ blockedUserIds: ["u-ada"] }));
  });

  it("keeps the primary action disabled until a name is given", () => {
    render(<EditChannelModal {...baseProps()} channelName="" />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
