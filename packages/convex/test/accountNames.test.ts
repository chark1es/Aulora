import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { accountDisplayName } from "../convex/lib/accountNames";
import { newTest, seedWorkspace } from "./helpers";

describe("accountDisplayName", () => {
  it("prefers the profile name, then the email local part", () => {
    expect(accountDisplayName({ name: "Ada Lovelace", email: "ada@acme.com" })).toBe(
      "Ada Lovelace",
    );
    expect(accountDisplayName({ name: "  ", email: "ada@acme.com" })).toBe("ada");
    expect(accountDisplayName({ email: "grace@acme.com" })).toBe("grace");
    expect(accountDisplayName({ name: null, email: null })).toBeNull();
    expect(accountDisplayName(null)).toBeNull();
  });
});

describe("members.list account names", () => {
  it("returns every member with an accountName field, even without the auth component", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const members = await t.withIdentity({ subject: "user-1" }).query(api.members.list, {});
    expect(members.map((member) => member.userId)).toEqual(["user-1", "user-2"]);
    for (const member of members) {
      expect(member).toHaveProperty("accountName", null);
    }
  });
});
