import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNUP_POLICY,
  emailDomainAllowed,
  shouldAutoAttachRoles,
  signupBlocked,
} from "../convex/lib/authPolicy";

describe("signup policy", () => {
  it("allows any email when the domain allow-list is empty", () => {
    expect(emailDomainAllowed("a@example.com", [])).toBe(true);
    expect(emailDomainAllowed(undefined, [])).toBe(true);
  });

  it("enforces allowed domains, tolerating case and an @ prefix", () => {
    expect(emailDomainAllowed("a@Example.com", ["example.com"])).toBe(true);
    expect(emailDomainAllowed("a@example.com", ["@Example.com"])).toBe(true);
    expect(emailDomainAllowed("a@other.com", ["example.com"])).toBe(false);
    expect(emailDomainAllowed("no-domain", ["example.com"])).toBe(false);
  });

  it("blocks creation only when signup is disabled or the domain is disallowed", () => {
    expect(signupBlocked(DEFAULT_SIGNUP_POLICY, "a@example.com")).toBe(false);
    expect(signupBlocked({ ...DEFAULT_SIGNUP_POLICY, signupEnabled: false }, "a@example.com")).toBe(
      true,
    );
    expect(
      signupBlocked(
        { ...DEFAULT_SIGNUP_POLICY, allowedEmailDomains: ["example.com"] },
        "a@other.com",
      ),
    ).toBe(true);
  });

  it("auto-attaches roles only when the workspace is not invite-only", () => {
    expect(shouldAutoAttachRoles({ ...DEFAULT_SIGNUP_POLICY, inviteOnly: true })).toBe(false);
    expect(shouldAutoAttachRoles({ ...DEFAULT_SIGNUP_POLICY, inviteOnly: false })).toBe(true);
  });
});
