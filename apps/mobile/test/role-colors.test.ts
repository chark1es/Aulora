import { describe, expect, it } from "vitest";
import type { RoleView } from "../src/lib/permissions";
import {
  EMPTY_ROLE_COLOR_PAGE,
  manageableRoleColors,
  roleColorBackTarget,
  roleColorDraftChanged,
  roleColorPageReducer,
  roleColorSavePatch,
  roleColorSummary,
} from "../src/lib/role-colors";

function role(overrides: Partial<RoleView> & Pick<RoleView, "id" | "name" | "position">): RoleView {
  return {
    key: overrides.id,
    color: null,
    permissions: 0n,
    hoisted: false,
    mentionable: false,
    isEveryone: false,
    ...overrides,
  };
}

const roles: RoleView[] = [
  role({ id: "everyone", name: "@everyone", position: 0, isEveryone: true }),
  role({ id: "member", name: "Member", position: 2, color: "#248A3D" }),
  role({ id: "mod", name: "Moderator", position: 5, color: "#E8A33B", mentionable: true }),
  role({ id: "owner", name: "Owner", position: 9, color: "#7C5CFF" }),
];

describe("mobile role color editor", () => {
  it("lists roles highest first with hierarchy-aware editability", () => {
    const rows = manageableRoleColors(roles, { isOwner: false, topPosition: 5 }, true);
    expect(rows.map((row) => row.role.id)).toEqual(["owner", "mod", "member", "everyone"]);
    expect(rows.map((row) => row.editable)).toEqual([false, false, true, false]);
  });

  it("lets an owner edit every role including @everyone", () => {
    const rows = manageableRoleColors(roles, { isOwner: true, topPosition: Infinity }, true);
    expect(rows.every((row) => row.editable)).toBe(true);
  });

  it("locks every role without ManageRoles", () => {
    const rows = manageableRoleColors(roles, { isOwner: false, topPosition: 9 }, false);
    expect(rows.some((row) => row.editable)).toBe(false);
  });

  it("leaves the page when the open role was deleted or became unmanageable", () => {
    const rows = manageableRoleColors(roles, { isOwner: true, topPosition: Infinity }, true);
    const open = { selectedId: "mod", draftColor: "#E8A33B", error: null };
    expect(roleColorBackTarget(open, rows)).toBe("editor");

    // Another authorized client deletes the role: the page falls back to the
    // list, but selectedId is still set. Back must leave the page, not call
    // the editor step that returns immediately.
    const deletedRows = manageableRoleColors(
      roles.filter((entry) => entry.id !== "mod"),
      { isOwner: true, topPosition: Infinity },
      true,
    );
    expect(roleColorBackTarget(open, deletedRows)).toBe("list");
  });

  it("builds a trimmed save patch and refuses invalid colors", () => {
    const moderator = roles[2];
    expect(moderator).toBeDefined();
    if (moderator === undefined) return;
    expect(roleColorSavePatch(moderator, "  #7c5cff ")).toEqual({
      roleId: "mod",
      color: "#7C5CFF",
    });
    expect(roleColorSavePatch(moderator, "")).toEqual({ roleId: "mod", color: "" });
    expect(roleColorSavePatch(moderator, "not-a-color")).toBeNull();
  });

  it("summarizes empty and set colors", () => {
    expect(roleColorSummary(null)).toBe("No color");
    expect(roleColorSummary("  ")).toBe("No color");
    expect(roleColorSummary("#7c5cff")).toBe("#7C5CFF");
    expect(roleColorSummary("abc")).toBe("#AABBCC");
    expect(roleColorSummary("not-hex")).toBe("No color");
  });

  it("opens the role editor from the saved color and clears stale edits on back", () => {
    const moderator = roles[2];
    expect(moderator).toBeDefined();
    if (moderator === undefined) return;
    const opened = roleColorPageReducer(EMPTY_ROLE_COLOR_PAGE, { type: "open", role: moderator });
    expect(opened).toEqual({ selectedId: "mod", draftColor: "#E8A33B", error: null });
    const edited = roleColorPageReducer(
      roleColorPageReducer(opened, { type: "draft", color: "#123456" }),
      { type: "error", message: "Couldn’t save the color." },
    );
    expect(edited).toEqual({
      selectedId: "mod",
      draftColor: "#123456",
      error: "Couldn’t save the color.",
    });
    expect(roleColorPageReducer(edited, { type: "back" })).toEqual(EMPTY_ROLE_COLOR_PAGE);
  });

  it("asks before discarding a changed color but not for an unchanged one", () => {
    const moderator = roles[2];
    if (moderator === undefined) return;
    // Opening the editor seeds the draft from the saved color.
    expect(roleColorDraftChanged(moderator.color, "#E8A33B")).toBe(false);
    expect(roleColorDraftChanged(moderator.color, " #e8a33b ")).toBe(false);
    expect(roleColorDraftChanged(moderator.color, "#123456")).toBe(true);
    // Clearing a role that had no color is not a change either.
    expect(roleColorDraftChanged(null, "")).toBe(false);
    expect(roleColorDraftChanged(null, "#123456")).toBe(true);
  });
});
