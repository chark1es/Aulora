import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../components/chat/Composer";

const base = {
  channelId: "c1",
  members: [{ userId: "u-ada", displayName: "Ada" }],
  roles: [],
  memberIds: ["u-ada", "me"],
  onTyping: vi.fn(),
  onSend: vi.fn(),
};

describe("Composer mention-scope notice", () => {
  it("reserves nothing when there is no hint to show", () => {
    render(<Composer {...base} canMentionEveryone={false} mentionMarkers={false} />);
    expect(screen.queryByTestId("composer-notice")).not.toBeInTheDocument();
    // The old layout always mounted a 48px row here, so an empty composer paid
    // for it and the message list shifted when a hint appeared.
    expect(document.querySelector(".h-12")).toBeNull();
  });

  it("floats the hint above the composer instead of taking a row in it", () => {
    render(
      <Composer
        {...base}
        canMentionEveryone={false}
        mentionMarkers={false}
        massMentionHint="Everyone will be notified."
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ship it @here" } });
    const notice = screen.getByTestId("composer-notice");
    expect(notice).toHaveTextContent("Everyone will be notified.");
    // Absolute positioning above the composer keeps the message list still:
    // the row no longer participates in the composer's layout at all.
    expect(notice.className).toContain("absolute");
    expect(notice.className).toContain("bottom-full");
  });

  it("stays quiet when the viewer may notify everyone", () => {
    render(<Composer {...base} canMentionEveryone mentionMarkers />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ship it @here" } });
    expect(screen.queryByTestId("composer-notice")).not.toBeInTheDocument();
  });
});
