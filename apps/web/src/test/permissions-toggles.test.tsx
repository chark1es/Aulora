import { Permission } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionsToggles } from "../components/admin/PermissionsToggles";

describe("PermissionsToggles", () => {
  it("disables flags the viewer cannot grant", () => {
    render(
      <PermissionsToggles
        value={0n}
        grantable={Permission.ManageRoles | Permission.Kick}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Manage roles")).toBeEnabled();
    expect(screen.getByLabelText("Kick members")).toBeEnabled();
    expect(screen.getByLabelText("Ban members")).toBeDisabled();
    expect(screen.getByLabelText("Administrator")).toBeDisabled();
  });

  it("lets an elevated flag that is already set be removed but not re-added", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PermissionsToggles
        value={Permission.Administrator | Permission.Kick}
        grantable={Permission.Kick}
        onChange={onChange}
      />,
    );

    const admin = screen.getByLabelText("Administrator");
    expect(admin).toBeChecked();
    expect(admin).toBeEnabled();
    await user.click(admin);
    expect(onChange).toHaveBeenCalledWith(Permission.Kick);
  });

  it("allows every flag when no grant ceiling is given", () => {
    render(<PermissionsToggles value={0n} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Administrator")).toBeEnabled();
  });
});
