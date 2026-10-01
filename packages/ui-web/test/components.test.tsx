import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  Card,
  DotGrid,
  Heading,
  Icon,
  IconButton,
  Input,
  Logo,
  Modal,
  SegmentedControl,
  Select,
  Spinner,
  Switch,
  Text,
} from "../src";

describe("Button", () => {
  it("renders a soft-cornered button and defaults to type=button", () => {
    render(<Button>Connect</Button>);
    const button = screen.getByRole("button", { name: "Connect" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("rounded-input");
    expect(button.className).toContain("text-on-accent");
  });

  it("shows the particle spinner and blocks interaction while loading", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).not.toBeNull();
  });
});

describe("IconButton", () => {
  it("requires and exposes an accessible label", () => {
    render(
      <IconButton label="Add a server">
        <span aria-hidden="true">+</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Add a server" })).toBeInTheDocument();
  });
});

describe("Input", () => {
  it("associates the label and help text with the input", () => {
    render(<Input label="Server" hint="chat.acme.com" defaultValue="acme" />);
    const input = screen.getByLabelText("Server");
    expect(input).toHaveValue("acme");
    expect(input).toHaveAccessibleDescription("chat.acme.com");
  });

  it("marks the field invalid and announces the error", () => {
    render(<Input label="Server" error="Enter a valid host" />);
    expect(screen.getByLabelText("Server")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid host");
  });
});

describe("Text and Heading", () => {
  it("renders the requested heading element and size", () => {
    render(<Heading level={1}>Aulora</Heading>);
    const heading = screen.getByRole("heading", { level: 1, name: "Aulora" });
    expect(heading.className).toContain("text-3xl");
  });

  it("applies tone and mono classes", () => {
    render(
      <Text as="span" tone="muted" mono>
        projects/main
      </Text>,
    );
    const text = screen.getByText("projects/main");
    expect(text.className).toContain("text-text-muted");
    expect(text.className).toContain("font-mono");
  });
});

describe("Card and DotGrid", () => {
  it("renders a hairline card at the card radius", () => {
    render(<Card>Workspace</Card>);
    const card = screen.getByText("Workspace");
    expect(card.className).toContain("rounded-card");
    expect(card.className).toContain("border-border");
  });

  it("draws the dot grid on a 16px pitch using token variables", () => {
    render(<DotGrid data-testid="grid" />);
    const grid = screen.getByTestId("grid");
    expect(grid.style.backgroundSize).toBe("16px 16px");
    expect(grid.style.backgroundImage).toContain("--aulora-grid-dot");
    expect(grid).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Spinner and Logo", () => {
  it("exposes a status role with a configurable label", () => {
    render(<Spinner label="Reconnecting" size={20} />);
    expect(screen.getByRole("status", { name: "Reconnecting" })).toBeInTheDocument();
  });

  it("labels the logo only when a title is provided", () => {
    const { rerender } = render(<Logo />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(<Logo title="Aulora" />);
    expect(screen.getByRole("img", { name: "Aulora" })).toBeInTheDocument();
  });
});

describe("Icon", () => {
  it("renders the shared path data as a decorative filled icon", () => {
    const { container } = render(<Icon name="send" size={18} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg?.querySelectorAll("path").length).toBe(1);
  });
});

describe("Switch", () => {
  it("exposes switch semantics and toggles", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Make private" />);
    const control = screen.getByRole("switch", { name: "Make private" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("SegmentedControl", () => {
  it("marks the active option with radio semantics", () => {
    render(
      <SegmentedControl
        label="Appearance"
        value="dark"
        onChange={() => undefined}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });
});

describe("Select", () => {
  it("opens a listbox and reports the chosen value", () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Timeout"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "60s" },
          { value: "b", label: "5m" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Timeout/ }));
    fireEvent.click(screen.getByRole("option", { name: "5m" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("Modal", () => {
  it("renders a labelled dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} label="Create a channel" title="Create a channel">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Create a channel" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    // Closing keeps the element mounted through its exit transition.
    rerender(
      <Modal open={false} onClose={onClose} label="Create a channel" title="Create a channel">
        <p>Body</p>
      </Modal>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
