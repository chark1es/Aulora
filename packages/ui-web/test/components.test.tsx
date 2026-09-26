import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Card, DotGrid, Heading, IconButton, Input, Logo, Spinner, Text } from "../src";

describe("Button", () => {
  it("renders a pill button and defaults to type=button", () => {
    render(<Button>Connect</Button>);
    const button = screen.getByRole("button", { name: "Connect" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("rounded-pill");
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
