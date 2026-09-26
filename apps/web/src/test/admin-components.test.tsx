import { Permission } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OverridesEditor } from "../components/admin/OverridesEditor";
import { PermissionsToggles } from "../components/admin/PermissionsToggles";
import { RedeemCard } from "../components/admin/RedeemScreen";

describe("PermissionsToggles", () => {
  it("toggles a flag and reports the new bitfield", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PermissionsToggles value={0n} onChange={onChange} />);

    await user.click(screen.getByLabelText("Kick members"));
    expect(onChange).toHaveBeenCalledWith(Permission.Kick);
  });

  it("reflects already-held flags", () => {
    render(<PermissionsToggles value={Permission.Ban | Permission.Kick} onChange={() => {}} />);
    expect(screen.getByLabelText("Ban members")).toBeChecked();
    expect(screen.getByLabelText("View channels")).not.toBeChecked();
  });
});

describe("OverridesEditor", () => {
  const targets = [
    { targetId: "Moderator", targetType: "role" as const, label: "Moderator" },
    { targetId: "user-1", targetType: "member" as const, label: "Alice" },
  ];

  it("sets an allow override for the chosen target and saves it", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <OverridesEditor
        title="Channel overrides"
        overrides={[]}
        targets={targets}
        onSave={onSave}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Channel overrides target"), "role:Moderator");
    await user.click(screen.getByLabelText("Kick members allow"));
    await user.click(screen.getByRole("button", { name: "Save overrides" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as { targetId: string; allow: bigint }[];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.targetId).toBe("Moderator");
    expect(saved[0]?.allow).toBe(Permission.Kick);
  });

  it("clears an override back to inherit", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <OverridesEditor
        title="Channel overrides"
        overrides={[
          { targetId: "Moderator", targetType: "role", allow: 0n, deny: Permission.Kick },
        ]}
        targets={targets}
        onSave={onSave}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Channel overrides target"), "role:Moderator");
    await user.click(screen.getByLabelText("Kick members inherit"));
    await user.click(screen.getByRole("button", { name: "Save overrides" }));

    expect(onSave.mock.calls[0]?.[0]).toEqual([]);
  });
});

describe("RedeemCard", () => {
  it("invokes onJoin from the idle state", async () => {
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(
      <RedeemCard
        code="abc"
        state="idle"
        message={null}
        error={null}
        onJoin={onJoin}
        onContinue={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Join workspace" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("shows the error and a retry affordance", () => {
    render(
      <RedeemCard
        code="abc"
        state="idle"
        message={null}
        error="Invite has expired"
        onJoin={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invite has expired");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers to continue after success", async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <RedeemCard
        code="abc"
        state="done"
        message="Welcome aboard."
        error={null}
        onJoin={() => {}}
        onContinue={onContinue}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Go to the workspace" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
