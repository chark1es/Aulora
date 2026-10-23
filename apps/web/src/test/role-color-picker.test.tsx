import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoleColorPicker } from "../components/admin/RoleColorPicker";

describe("RoleColorPicker", () => {
  it("renders a colour wheel and the preset palette", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Role color wheel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Use color #0E9F8E")).toBeInTheDocument();
  });

  it("picks a custom colour from the wheel with the keyboard", () => {
    const onChange = vi.fn();
    render(<RoleColorPicker value="#7C5CFF" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Role color wheel" }), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatch(/^#[0-9A-F]{6}$/);
    expect(onChange.mock.calls[0]?.[0]).not.toBe("#7C5CFF");
  });

  it("keeps the preset and clear actions working", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoleColorPicker value="#7C5CFF" onChange={onChange} />);

    await user.click(screen.getByLabelText("Use color #E4571C"));
    expect(onChange).toHaveBeenLastCalledWith("#E4571C");

    await user.click(screen.getByRole("button", { name: "Clear color" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("disables every control when the role is read-only", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("slider", { name: "Role color wheel" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByLabelText("Use color #0E9F8E")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear color" })).toBeDisabled();
  });
});
