import { describe, expect, it } from "vitest";
import { inviteUrl, parseInviteCode, redeemErrorMessage } from "../lib/invites";

describe("inviteUrl", () => {
  it("builds a shareable invite link and strips a trailing slash", () => {
    expect(inviteUrl("https://chat.acme.com/", "ABC123")).toBe(
      "https://chat.acme.com/invite/ABC123",
    );
    expect(inviteUrl("https://chat.acme.com", "A/B")).toBe("https://chat.acme.com/invite/A%2FB");
  });
});

describe("parseInviteCode", () => {
  it("trims and rejects empty codes", () => {
    expect(parseInviteCode(" ABC123 ")).toBe("ABC123");
    expect(parseInviteCode("   ")).toBeNull();
    expect(parseInviteCode(undefined)).toBeNull();
  });
});

describe("redeemErrorMessage", () => {
  it("prefers an error message and falls back", () => {
    expect(redeemErrorMessage(new Error("Invite expired"))).toBe("Invite expired");
    expect(redeemErrorMessage(null)).toBe("That invite could not be redeemed.");
  });
});
