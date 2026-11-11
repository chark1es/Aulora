import type { RoleView } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleEditor } from "../components/admin/RoleEditor";

const calls = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: { name?: string }) =>
    String(ref?.name ?? "").includes("update") ? calls.update : calls.create,
}));
vi.mock("../../../../packages/convex/convex/_generated/api", () => ({
  api: {
    roles: { create: { name: "create" }, update: { name: "update" }, remove: {}, reorder: {} },
  },
}));

const viewer = {
  userId: "owner",
  isOwner: true,
  roleIds: [],
  permissions: 0n,
  topPosition: 100,
};

function role(color: string | null): RoleView {
  return {
    id: "r1",
    key: "mod",
    name: "Moderator",
    color,
    position: 3,
    permissions: 0n,
    hoisted: false,
    mentionable: false,
    isEveryone: false,
  };
}

describe("RoleEditor colour saving", () => {
  beforeEach(() => {
    calls.create.mockReset().mockResolvedValue(undefined);
    calls.update.mockReset().mockResolvedValue(undefined);
  });

  it("refuses an unparseable stored colour with an inline error instead of clearing it", async () => {
    const user = userEvent.setup();
    render(
      <RoleEditor
        viewer={viewer}
        roles={[role("garbage")]}
        canManageRoles
        page={{ kind: "role", id: "r1" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByTestId("role-form-error")).toHaveTextContent(/valid hex color/);
    expect(calls.update).not.toHaveBeenCalled();
  });

  it("normalises a short hex and lets an empty colour clear it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <RoleEditor
        viewer={viewer}
        roles={[role("abc")]}
        canManageRoles
        page={{ kind: "role", id: "r1" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(calls.update).toHaveBeenLastCalledWith(expect.objectContaining({ color: "#AABBCC" }));
    unmount();

    render(
      <RoleEditor
        viewer={viewer}
        roles={[role("")]}
        canManageRoles
        page={{ kind: "role", id: "r1" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(calls.update).toHaveBeenLastCalledWith(expect.objectContaining({ color: "" }));
    expect(screen.queryByTestId("role-form-error")).not.toBeInTheDocument();
  });
});
