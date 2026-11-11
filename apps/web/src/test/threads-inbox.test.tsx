import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ThreadInboxItem, ThreadsInbox } from "../components/chat/ThreadsInbox";
import { UserSettingsView } from "../components/chat/UserSettingsView";

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function thread(id: string, extra: Partial<ThreadInboxItem> = {}): ThreadInboxItem {
  return {
    id,
    channelId: "c-general",
    authorId: "u-ada",
    body: `root body of ${id}`,
    createdAt: NOW,
    replyCount: 2,
    lastReplyAt: NOW,
    participantIds: ["u-ada"],
    mentionedUserIds: [],
    viewerParticipated: true,
    viewerMentioned: false,
    ...extra,
  };
}

const baseProps = {
  loading: false,
  channelNames: new Map([["c-general", "general"]]),
  memberNames: new Map([
    ["u-ada", "Ada Lovelace"],
    ["me", "Me"],
  ]),
  titles: new Map([["dm-1", "Bob Stone"]]),
  ownUserId: "me",
  onOpen: vi.fn(),
};

describe("ThreadsInbox", () => {
  it("renders a thread row with channel, reply count and opens it", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ThreadsInbox {...baseProps} threads={[thread("t1")]} onOpen={onOpen} />);
    const inbox = screen.getByTestId("threads-inbox");
    const row = within(inbox).getByTestId("thread-row-t1");
    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(row).getByText("#general")).toBeInTheDocument();
    expect(within(row).getByText("2 replies")).toBeInTheDocument();
    expect(within(row).getByText("root body of t1")).toBeInTheDocument();
    await user.click(row);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("labels a DM by its member-derived title and badges mentions", () => {
    render(
      <ThreadsInbox
        {...baseProps}
        threads={[
          thread("t2", {
            channelId: "dm-1",
            viewerMentioned: true,
          }),
        ]}
      />,
    );
    const row = screen.getByTestId("thread-row-t2");
    expect(within(row).getByText("Bob Stone")).toBeInTheDocument();
    expect(within(row).getByText("Mentioned you")).toBeInTheDocument();
  });

  it("shows an empty state and a loading state", () => {
    const { rerender } = render(<ThreadsInbox {...baseProps} threads={[]} />);
    expect(screen.getByText("No threads yet")).toBeInTheDocument();
    rerender(<ThreadsInbox {...baseProps} threads={[]} loading />);
    expect(screen.getByText("Loading threads…")).toBeInTheDocument();
  });
});

describe("UserSettingsView", () => {
  const viewProps = {
    ownUserId: "me",
    ownName: "Me",
    alignment: "left" as const,
    canEditNickname: true,
    onBack: vi.fn(),
    onSave: vi.fn(),
  };

  it("marks owners with an admin badge and saves settings", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<UserSettingsView {...viewProps} isOwner onSave={onSave} />);
    expect(screen.getByTestId("user-settings-admin-badge")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /^Bio/ }), "Updated bio");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ alignment: "left" }));
  });

  it("hides the admin badge for non-owners and returns to chat", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<UserSettingsView {...viewProps} isOwner={false} onBack={onBack} />);
    expect(screen.queryByTestId("user-settings-admin-badge")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(onBack).toHaveBeenCalled();
  });
});

it("closes the settings host after save resolves", async () => {
  const user = userEvent.setup();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? (
      <UserSettingsView
        ownUserId="me"
        ownName="Me"
        alignment="left"
        canEditNickname
        isOwner={false}
        onBack={() => setOpen(false)}
        onSave={async () => {
          setOpen(false);
        }}
      />
    ) : (
      <p>Chat</p>
    );
  }
  render(<Host />);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "Nickname" }), "New name");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Chat")).toBeInTheDocument();
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
});
it("resets the saved baseline when the settings host stays open", async () => {
  const user = userEvent.setup();
  render(
    <UserSettingsView
      ownUserId="me"
      ownName="Me"
      alignment="left"
      canEditNickname
      isOwner={false}
      onBack={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />,
  );
  await user.type(screen.getByRole("textbox", { name: "Nickname" }), "New name");
  await user.type(screen.getByRole("textbox", { name: /^Bio/ }), "New bio");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  expect(screen.getByRole("textbox", { name: /^Bio/ })).toHaveValue("New bio");
  expect(screen.getByRole("textbox", { name: "Nickname" })).toHaveValue("");
});
it.each(["Back to chat", "Cancel"])("guards dirty settings from %s", async (label) => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(
    <UserSettingsView
      ownUserId="me"
      ownName="Me"
      alignment="left"
      canEditNickname
      isOwner={false}
      onBack={onBack}
      onSave={vi.fn()}
    />,
  );
  await user.type(screen.getByRole("textbox", { name: "Nickname" }), "Unsaved");
  await user.click(screen.getByRole("button", { name: label }));
  expect(onBack).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", {
      name: "Discard changes",
    }),
  );
  expect(onBack).toHaveBeenCalledOnce();
});
