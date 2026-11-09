import { describe, expect, it } from "vitest";
import { parseDomains } from "../components/admin/WorkspaceSettings";
import {
  auditActionLabel,
  auditCategory,
  auditEventFields,
  describeAuditAction,
  formatAuditEvent,
  shortId,
} from "../lib/audit-format";
import { inviteUrl, parseInviteCode, redeemErrorMessage } from "../lib/invites";

describe("audit-format", () => {
  it("labels known actions and humanizes unknown ones", () => {
    expect(auditActionLabel("role.create")).toBe("created a role");
    expect(auditActionLabel("unknown.action")).toBe("unknown action");
  });

  it("summarizes parseable metadata without leaking it raw", () => {
    expect(describeAuditAction("member.ban", '{"reason":"spam"}')).toBe(
      "Banned a member: spam · permanent",
    );
    expect(describeAuditAction("role.delete", "not-json")).toBe("Deleted a role");
    expect(describeAuditAction("role.delete", null)).toBe("Deleted a role");
  });

  it("drops opaque ids and maps known metadata to friendly copy", () => {
    expect(describeAuditAction("member.role.add", '{"roleId":"abc123"}')).toBe(
      "Gave a member a role",
    );
    expect(describeAuditAction("role.create", '{"name":"Moderator","position":3}')).toBe(
      "Created a role: Moderator",
    );
    expect(describeAuditAction("channel.create", '{"kind":"text","private":true}')).toBe(
      "Created a channel: text, private",
    );
  });

  it("builds a friendly sentence from resolved actor and target names", () => {
    expect(
      formatAuditEvent("member.ban", '{"reason":"spam"}', {
        actorName: "Ada",
        targetName: "Bob",
      }),
    ).toBe("Ada banned a member · Bob · spam · permanent");
    expect(formatAuditEvent("server.updateBranding", null, { actorName: "Ada" })).toBe(
      "Ada updated the workspace branding",
    );
  });

  it("names previously humanized actions and avoids repeating a target", () => {
    expect(auditActionLabel("kanban.updateBoard")).toBe("updated a kanban board");
    expect(auditActionLabel("workspaceNotes.setEnabled")).toBe("changed workspace notes");
    expect(auditActionLabel("addons.transcription.setEnabled")).toBe(
      "changed the transcription add-on",
    );
    expect(
      formatAuditEvent("category.create", '{"name":"Important"}', {
        actorName: "Ada",
        targetName: "Important",
      }),
    ).toBe("Ada created a category · Important");
  });

  it("describes sign-in provider toggles in plain language", () => {
    expect(
      formatAuditEvent("instance.authProviders.update", '{"google":true}', {
        actorName: "Ada",
      }),
    ).toBe("Ada enabled Google sign-in");
    expect(
      formatAuditEvent("instance.authProviders.update", '{"google":true,"local":false}', {
        actorName: "Ada",
      }),
    ).toBe("Ada enabled Google sign-in and disabled email & password sign-in");
  });

  it("turns enable toggles into a sentence", () => {
    expect(formatAuditEvent("kanban.setEnabled", '{"enabled":true}', { actorName: "Ada" })).toBe(
      "Ada turned on the kanban add-on",
    );
    expect(
      formatAuditEvent("workspaceNotes.setEnabled", '{"enabled":false}', { actorName: "Ada" }),
    ).toBe("Ada turned off workspace notes");
  });

  it("lists the auth providers changed in an auth-providers update", () => {
    expect(
      describeAuditAction("instance.authProviders.update", '{"local":false,"github":true}'),
    ).toBe("Changed sign-in providers: enabled GitHub sign-in, disabled email & password sign-in");
    expect(describeAuditAction("instance.authProviders.update", "{}")).toBe(
      "Changed sign-in providers",
    );
  });

  it("builds structured detail fields for the event dialog", () => {
    expect(
      auditEventFields("instance.authProviders.update", '{"google":true,"local":false}'),
    ).toEqual([
      { label: "Google sign-in", value: "Enabled" },
      { label: "Email & password sign-in", value: "Disabled" },
    ]);
    expect(
      auditEventFields("invite.create", '{"kind":"code","expiresAt":null,"custom":false}'),
    ).toEqual([
      { label: "Type", value: "Code invite" },
      { label: "Expires", value: "Never" },
      { label: "Custom code", value: "No" },
    ]);
    expect(
      auditEventFields("member.role.add", '{"roleId":"role-1"}', {
        roleNames: new Map([["role-1", "Moderator"]]),
      }),
    ).toEqual([{ label: "Role", value: "Moderator" }]);
  });

  it("groups actions into categories and shortens opaque ids", () => {
    expect(auditCategory("member.ban")).toBe("member");
    expect(auditCategory("channel.rename")).toBe("channel");
    expect(auditCategory("mystery.action")).toBe("other");
    expect(shortId("abcdefghij")).toBe("abcdef…");
    expect(shortId("abc")).toBe("abc");
  });
});

describe("invite helpers", () => {
  it("builds and parses invite links", () => {
    expect(inviteUrl("http://localhost:8080/", "abc123")).toBe(
      "http://localhost:8080/invite/abc123",
    );
    expect(parseInviteCode("abc123")).toBe("abc123");
    expect(parseInviteCode("  ")).toBeNull();
    expect(parseInviteCode(undefined)).toBeNull();
  });

  it("maps failures to a friendly message", () => {
    expect(redeemErrorMessage(new Error("Invite not found"))).toBe("Invite not found");
    expect(redeemErrorMessage({})).toBe("That invite could not be redeemed.");
  });
});

describe("parseDomains", () => {
  it("trims, lowercases, strips @ and de-duplicates", () => {
    expect(parseDomains("Acme.com, @beta.io beta.io\n gamma.dev")).toEqual([
      "acme.com",
      "beta.io",
      "gamma.dev",
    ]);
  });
});
