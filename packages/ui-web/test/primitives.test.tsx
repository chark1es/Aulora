import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Kbd,
  ModalFooter,
  SearchInput,
  SettingsRow,
  SettingsRowGroup,
  Textarea,
  Tooltip,
} from "../src";

describe("Textarea", () => {
  it("associates the label, help text and error", () => {
    render(<Textarea label="Description" hint="Keep it short" error="Too long" />);
    const field = screen.getByLabelText("Description");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Keep it short Too long");
    expect(screen.getByRole("alert")).toHaveTextContent("Too long");
  });
});

describe("Checkbox", () => {
  it("reports toggles and wires the label to the control", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Archive" description="Hide it" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Archive" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Hide it")).toBeInTheDocument();
  });

  it("labels the bare box", () => {
    render(<Checkbox bare checked label="Ticked" onChange={() => undefined} />);
    expect(screen.getByRole("checkbox", { name: "Ticked" })).toBeChecked();
  });
});

describe("Badge", () => {
  it("applies the tone class", () => {
    render(<Badge tone="danger">Expired</Badge>);
    expect(screen.getByText("Expired").className).toContain("text-danger");
  });
});

describe("Tooltip", () => {
  it("exposes its label as a title", () => {
    render(
      <Tooltip label="Board settings">
        <span>gear</span>
      </Tooltip>,
    );
    expect(screen.getByTitle("Board settings")).toBeInTheDocument();
  });
});

describe("SearchInput", () => {
  it("is labelled, reports typing and clears", () => {
    const onChange = vi.fn();
    render(<SearchInput label="Search notes" value="abc" onChange={onChange} />);
    expect(screen.getByLabelText("Search notes")).toHaveValue("abc");
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledWith("abcd");
    fireEvent.click(screen.getByRole("button", { name: "Clear Search notes" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("EmptyState", () => {
  it("renders a title, description and action", () => {
    render(
      <EmptyState
        icon="note"
        title="Write your first note"
        description="Nothing here yet."
        action={<Button>New note</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Write your first note" })).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
  });
});

describe("Kbd", () => {
  it("renders a key cap", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });
});

describe("SettingsRow", () => {
  it("puts the label on the left and the control on the right", () => {
    render(
      <SettingsRowGroup>
        <SettingsRow label="Public invites" description="Let anyone join">
          <Checkbox bare checked label="Public invites" onChange={() => undefined} />
        </SettingsRow>
      </SettingsRowGroup>,
    );
    expect(screen.getByText("Public invites")).toBeInTheDocument();
    expect(screen.getByText("Let anyone join")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});

describe("ModalFooter", () => {
  it("separates a destructive action from the rest", () => {
    render(
      <ModalFooter destructive={<Button variant="danger">Delete</Button>}>
        <Button variant="secondary">Cancel</Button>
        <Button>Save</Button>
      </ModalFooter>,
    );
    expect(screen.getByRole("button", { name: "Delete" }).closest("span")?.className).toContain(
      "mr-auto",
    );
  });
});
