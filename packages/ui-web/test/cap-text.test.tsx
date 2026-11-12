import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Button, CAP_TEXT_CLASS, CapText, Icon } from "../src";

describe("cap-band labels", () => {
  it("wraps plain text in one cap-trimmed span and leaves elements alone", () => {
    render(
      <p data-testid="host">
        <CapText>
          {"Save "}
          {3}
        </CapText>
      </p>,
    );
    const label = screen.getByText("Save 3");
    expect(label.tagName).toBe("SPAN");
    expect(label.className).toBe(CAP_TEXT_CLASS);
    expect(CAP_TEXT_CLASS).toBe("[text-box:trim-both_cap_alphabetic]");
  });

  it("trims Button and Badge labels without touching icons", () => {
    render(
      <>
        <Button leading={<Icon name="plus" data-testid="icon" />}>Add member</Button>
        <Badge>Active</Badge>
      </>,
    );
    expect(screen.getByText("Add member").className).toBe(CAP_TEXT_CLASS);
    expect(screen.getByText("Active").className).toBe(CAP_TEXT_CLASS);
    expect(screen.getByTestId("icon").closest(`.${CSS.escape(CAP_TEXT_CLASS)}`)).toBeNull();
    // Material Symbols' blank viewBox edge: the group gives back 2px of start padding.
    expect(screen.getByRole("button", { name: "Add member" }).className).toContain("pl-3");
  });

  it("keeps fixed heights so trimming never shrinks a control", () => {
    render(<Badge size="sm">New</Badge>);
    expect(screen.getByText("New").parentElement?.className).toContain("h-[18px]");
  });
});
