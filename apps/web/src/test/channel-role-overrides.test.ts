import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  canEditChannelRole,
  mergeRoleOverrides,
  roleOverridesFor,
  sameOverrides,
} from "../components/chat/channel-role-overrides";
import type { OverrideView } from "../lib/workspace-admin";

const blocked: OverrideView = {
  targetId: "user-2",
  targetType: "member",
  allow: 0n,
  deny: Permission.ViewChannel,
};
const modRole: OverrideView = {
  targetId: "mod",
  targetType: "role",
  allow: Permission.SendMessages,
  deny: 0n,
};
const highRole: OverrideView = {
  targetId: "high",
  targetType: "role",
  allow: Permission.ViewChannel,
  deny: 0n,
};

describe("channel role override helpers", () => {
  it("extracts only role-target overrides", () => {
    expect(roleOverridesFor([blocked, modRole, highRole])).toEqual([modRole, highRole]);
  });

  it("merges managed role overrides while preserving members and higher roles", () => {
    const merged = mergeRoleOverrides(
      [blocked, modRole, highRole],
      [{ targetId: "mod", targetType: "role", allow: 0n, deny: Permission.ViewChannel }],
      new Set(["mod"]),
    );
    expect(merged).toEqual([
      blocked,
      highRole,
      { targetId: "mod", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
    ]);
  });

  it("drops a role override emptied to 0/0 instead of writing it back", () => {
    const merged = mergeRoleOverrides(
      [blocked, modRole],
      [{ targetId: "mod", targetType: "role", allow: 0n, deny: 0n }],
      new Set(["mod"]),
    );
    expect(merged).toEqual([blocked]);
  });

  it("compares overrides order-insensitively by target and bits", () => {
    expect(sameOverrides([blocked, modRole], [modRole, blocked])).toBe(true);
    expect(sameOverrides([modRole], [{ ...modRole, allow: Permission.ManageChannels }])).toBe(
      false,
    );
    expect(sameOverrides([modRole], [modRole, blocked])).toBe(false);
  });

  it("mirrors the server hierarchy, allowing @everyone only when outranked", () => {
    const viewer = { isOwner: false, topPosition: 5 };
    expect(canEditChannelRole(viewer, { id: "@everyone", name: "@everyone", position: 0 })).toBe(
      true,
    );
    expect(canEditChannelRole(viewer, { id: "junior", name: "Junior", position: 2 })).toBe(true);
    expect(canEditChannelRole(viewer, { id: "high", name: "High", position: 9 })).toBe(false);
    expect(
      canEditChannelRole(
        { isOwner: true, topPosition: -1 },
        { id: "high", name: "High", position: 9 },
      ),
    ).toBe(true);
  });
});
