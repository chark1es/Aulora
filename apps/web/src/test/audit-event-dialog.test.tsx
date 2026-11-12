import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuditEventDialog, type AuditEventView } from "../components/admin/AuditEventDialog";

function event(overrides: Partial<AuditEventView>): AuditEventView {
  return {
    id: "audit-1",
    actorId: "user-1",
    actorName: "Aulora Owner",
    action: "instance.authProviders.update",
    targetId: null,
    targetName: "",
    meta: null,
    at: Date.UTC(2026, 10, 7, 12, 0, 0),
    ...overrides,
  };
}

describe("AuditEventDialog", () => {
  it("explains a sign-in provider change instead of showing raw toggles", () => {
    render(
      <AuditEventDialog
        event={event({ meta: JSON.stringify({ google: true, local: false }) })}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Audit event" });
    expect(dialog).toHaveTextContent(
      "Aulora Owner enabled Google sign-in and disabled email & password sign-in",
    );
    expect(dialog).toHaveTextContent("Google sign-in");
    expect(dialog).toHaveTextContent("Enabled");
    expect(dialog).toHaveTextContent("Email & password sign-in");
    expect(dialog).toHaveTextContent("Disabled");
  });

  it("resolves metadata names and closes on request", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AuditEventDialog
        event={event({
          actorId: "user-1",
          action: "member.role.add",
          targetId: "user-2",
          targetName: "Bob",
          meta: JSON.stringify({ roleId: "role-1" }),
        })}
        roleNames={new Map([["role-1", "Moderator"]])}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Aulora Owner gave a member a role · Bob · Moderator",
    );
    await user.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
