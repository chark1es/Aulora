import { describe, expect, it } from "vitest";
import {
  allowlistAdmits,
  formatAccessCode,
  isAccessCodeShape,
  joinCodeFailureMessage,
  maskEmail,
  normalizeInviteCode,
  parseAllowlistEntry,
  redeemOutcomeMessage,
} from "../src/invites";

describe("normalizeInviteCode", () => {
  it("keeps link tokens as lowercase hex", () => {
    const token = `${"a".repeat(46)}B1`;
    expect(normalizeInviteCode(token)).toBe(token.toLowerCase());
  });

  it("canonicalises an access code typed any way", () => {
    expect(normalizeInviteCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeInviteCode(" abcd efgh jkmn ")).toBe("ABCDEFGHJKMN");
    expect(normalizeInviteCode("OIlO-0000-0000")).toBe("011000000000");
  });

  it("reads the code out of a pasted invite link", () => {
    expect(normalizeInviteCode("https://chat.acme.com/invite/ABCD-EFGH-JKMN?x=1")).toBe(
      "ABCDEFGHJKMN",
    );
    expect(normalizeInviteCode(`https://chat.acme.com/invite/${"c".repeat(48)}`)).toBe(
      "c".repeat(48),
    );
  });
});

describe("access code display", () => {
  it("groups a code and leaves other strings alone", () => {
    expect(formatAccessCode("abcdefghjkmn")).toBe("ABCD-EFGH-JKMN");
    expect(isAccessCodeShape("ABCD-EFGH-JKMN")).toBe(true);
    expect(isAccessCodeShape("ABCD-EFGH")).toBe(false);
    expect(formatAccessCode("short")).toBe("short");
  });
});

describe("allowlist", () => {
  it("parses addresses and domains", () => {
    expect(parseAllowlistEntry(" Sam@Acme.com ")).toEqual({
      pattern: "sam@acme.com",
      kind: "email",
    });
    expect(parseAllowlistEntry("@Acme.com")).toEqual({ pattern: "@acme.com", kind: "domain" });
    expect(parseAllowlistEntry("acme.com")).toBeNull();
    expect(parseAllowlistEntry("@acme")).toBeNull();
  });

  it("admits exact addresses and whole domains, case-insensitively", () => {
    const patterns = ["sam@acme.com", "@corp.io"];
    expect(allowlistAdmits(patterns, "SAM@acme.com")).toBe(true);
    expect(allowlistAdmits(patterns, "anyone@corp.io")).toBe(true);
    expect(allowlistAdmits(patterns, "other@acme.com")).toBe(false);
    expect(allowlistAdmits(patterns, "x@sub.corp.io")).toBe(false);
    expect(allowlistAdmits(patterns, null)).toBe(false);
  });
});

describe("maskEmail", () => {
  it("hides all but the first character of the local part", () => {
    expect(maskEmail("Jordan@Example.com")).toBe("j***@example.com");
  });
});

describe("outcome messages", () => {
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

  it("maps every join-code failure to words", () => {
    expect(joinCodeFailureMessage("expired")).toContain("expired");
    expect(joinCodeFailureMessage("something-new")).toBe("That code did not work.");
  });
});
