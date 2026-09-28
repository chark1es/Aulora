import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../components/chat/Composer";

describe("Composer file drop", () => {
  const base = {
    channelId: "c1",
    members: [{ userId: "u-ada", displayName: "Ada" }],
    roles: [],
    memberIds: ["u-ada", "me"],
    onTyping: vi.fn(),
    onSend: vi.fn(),
  };

  it("attaches files dropped anywhere in the window", () => {
    render(<Composer {...base} />);
    const file = new File(["hello"], "report.pdf", { type: "application/pdf" });
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(screen.getByTestId("composer-attachments")).toHaveTextContent("report.pdf");
  });

  it("ignores non-file drags and shows no overlay", () => {
    render(<Composer {...base} />);
    fireEvent.dragEnter(window, { dataTransfer: { types: ["text/plain"] } });
    fireEvent.dragOver(window, { dataTransfer: { types: ["text/plain"] } });
    fireEvent.drop(window, { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByTestId("composer-attachments")).not.toBeInTheDocument();
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
  });

  it("removes the overlay when a file drag leaves the window", () => {
    render(<Composer {...base} />);
    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
    fireEvent.dragLeave(window, { relatedTarget: null });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
  });

  it("only the primary composer owns the app-wide drop target", () => {
    render(
      <div>
        <div data-testid="primary">
          <Composer {...base} />
        </div>
        <div data-testid="secondary">
          <Composer {...base} draftKey="thread:t1" windowDropEnabled={false} />
        </div>
      </div>,
    );
    const file = new File(["hello"], "report.pdf", { type: "application/pdf" });
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });

    const primary = screen.getByTestId("primary");
    const secondary = screen.getByTestId("secondary");
    expect(within(primary).getByTestId("composer-attachments")).toHaveTextContent("report.pdf");
    expect(within(secondary).queryByTestId("composer-attachments")).not.toBeInTheDocument();
  });

  it("a drop on the secondary composer stays local and does not reach the primary", () => {
    render(
      <div>
        <div data-testid="primary">
          <Composer {...base} />
        </div>
        <div data-testid="secondary">
          <Composer {...base} draftKey="thread:t1" windowDropEnabled={false} />
        </div>
      </div>,
    );
    const secondary = screen.getByTestId("secondary");
    const dropTarget = secondary.firstElementChild;
    expect(dropTarget).not.toBeNull();
    const file = new File(["hello"], "reply.pdf", { type: "application/pdf" });
    fireEvent.drop(dropTarget as Element, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(within(secondary).getByTestId("composer-attachments")).toHaveTextContent("reply.pdf");
    expect(
      within(screen.getByTestId("primary")).queryByTestId("composer-attachments"),
    ).not.toBeInTheDocument();
  });
});
