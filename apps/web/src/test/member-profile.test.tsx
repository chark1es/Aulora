import { ContextMenuProvider } from "@aulora/ui-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberProfilePopover } from "../components/chat/MemberProfilePopover";
import { MembersPanel } from "../components/chat/MembersPanel";
import { UserSettingsView } from "../components/chat/UserSettingsView";

const member = { userId: "ada", displayName: "Ada Lovelace" };
let anchor: HTMLButtonElement;

beforeEach(() => {
  anchor = document.createElement("button");
  anchor.textContent = "Profile trigger";
  document.body.append(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 120, 240, 44));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  anchor.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("member profiles", () => {
  it("places the popover left of its member, keeps it on screen, and follows scrolling", () => {
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 680, 240, 44));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
    render(
      <MemberProfilePopover
        member={member}
        anchor={anchor}
        status="offline"
        profile={{ bio: null, lastOnlineAt: null }}
        onMessage={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const popover = screen.getByRole("dialog");
    expect(popover).toHaveStyle({ left: "568px", top: `${window.innerHeight - 248}px` });
    expect(popover).not.toHaveAttribute("aria-modal");
    expect(popover.parentElement).toBe(document.body);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 160, 240, 44));
    fireEvent.scroll(window);
    expect(popover).toHaveStyle({ left: "568px", top: "160px" });
  });

  it("dismisses outside presses without blocking them and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    const onOutsideClick = vi.fn();
    function Example() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={onOutsideClick}>
            Outside action
          </button>
          {open && (
            <MemberProfilePopover
              member={member}
              anchor={anchor}
              status="offline"
              profile={{ bio: null, lastOnlineAt: null }}
              onMessage={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    const { unmount } = render(<Example />);
    await user.click(screen.getByRole("button", { name: "Outside action" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOutsideClick).toHaveBeenCalledOnce();
    unmount();
    render(<Example />);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(anchor).toHaveFocus();
  });

  it("opens a profile when clicking a member, without starting a DM", async () => {
    const onViewProfile = vi.fn();
    const onMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenuProvider>
        <MembersPanel
          members={[member, { userId: "me", displayName: "Me" }]}
          presence={[]}
          customStatuses={new Map()}
          ownUserId="me"
          onViewProfile={onViewProfile}
          onMessage={onMessage}
          onClose={vi.fn()}
        />
      </ContextMenuProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
    expect(onViewProfile).toHaveBeenCalledWith(
      "ada",
      screen.getByRole("button", { name: /Ada Lovelace/ }),
    );
    expect(onMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Me/ })).toBeDisabled();
  });

  it("shows the name, last online time and bio, then opens a DM", async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const lastOnlineAt = new Date("2026-09-28T12:00:00Z").getTime();
    render(
      <MemberProfilePopover
        anchor={anchor}
        member={member}
        status="offline"
        profile={{ bio: "I build things.\nSay hello!", lastOnlineAt }}
        onMessage={onMessage}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: member.displayName })).toBeInTheDocument();
    expect(screen.getByText(/I build things/)).toHaveTextContent("Say hello!");
    expect(
      screen.getByText("Last online").nextElementSibling?.querySelector("time"),
    ).toHaveAttribute("datetime", new Date(lastOnlineAt).toISOString());
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(onMessage).toHaveBeenCalledWith("ada");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows missing details, supports Escape, and allows retry after a DM failure", async () => {
    const onClose = vi.fn();
    const onMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemberProfilePopover
        anchor={anchor}
        member={member}
        status="offline"
        profile={{ bio: null, lastOnlineAt: null }}
        onMessage={onMessage}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("No bio yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("shows loading and online states and disables messaging for a departed member", () => {
    const props = { member, anchor, onMessage: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(
      <MemberProfilePopover {...props} status="online" profile={undefined} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading profile");
    rerender(
      <MemberProfilePopover
        {...props}
        status="online"
        profile={{ bio: null, lastOnlineAt: null }}
      />,
    );
    expect(screen.getByText("Online now")).toBeInTheDocument();
    rerender(<MemberProfilePopover {...props} status="offline" profile={null} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("loads and saves a bio in account settings without nickname permission", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <UserSettingsView
        ownUserId="me"
        ownName="Me"
        ownBio="Old bio"
        alignment="left"
        canEditNickname={false}
        isOwner={false}
        onSave={onSave}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: /^Bio/ })).toHaveValue("Old bio");
    await user.clear(screen.getByRole("textbox", { name: /^Bio/ }));
    await user.type(screen.getByRole("textbox", { name: /^Bio/ }), "New bio");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ alignment: "left", bio: "New bio" }));
  });

  it("sends a chosen image as this workspace's profile picture", async () => {
    const onChangeAvatar = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <UserSettingsView
        ownUserId="me"
        ownName="Me"
        alignment="left"
        canEditNickname={false}
        isOwner={false}
        onSave={vi.fn()}
        onBack={vi.fn()}
        onChangeAvatar={onChangeAvatar}
      />,
    );
    const file = new File(["png"], "me.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Change profile picture"), file);
    await waitFor(() => expect(onChangeAvatar).toHaveBeenCalledWith(file));
  });
});
