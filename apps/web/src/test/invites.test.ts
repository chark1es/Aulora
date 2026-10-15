import { describe, expect, it } from "vitest";
import {
  inviteUrl,
  parseInviteCode,
  redeemErrorMessage,
  redeemOutcomeMessage,
} from "../lib/invites";

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

describe("redeemOutcomeMessage", () => {
  it("explains a refusal and greets a new member", () => {
    expect(redeemOutcomeMessage({ joined: false, message: "Invite has expired" })).toBe(
      "Invite has expired",
    );
    expect(redeemOutcomeMessage({ joined: false, message: "" })).toBe(
      "That invite could not be redeemed.",
    );
    expect(redeemOutcomeMessage({ joined: true, alreadyMember: false })).toBe("Welcome aboard.");
    expect(redeemOutcomeMessage({ joined: true, alreadyMember: true })).toBe(
      "You are already a member.",
    );
  });
});
