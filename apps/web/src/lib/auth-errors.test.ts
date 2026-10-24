import { afterEach, describe, expect, it } from "vitest";
import { describeAuthError, takeAuthErrorFromUrl } from "./auth-errors";

describe("describeAuthError", () => {
  it("explains a sign-up with an email that already has an account", () => {
    expect(describeAuthError("User already exists. Use another email.")).toMatch(
      /already exists for this email/,
    );
  });

  it("explains an OAuth sign-in the server would not link", () => {
    expect(describeAuthError("account_not_linked")).toMatch(/different sign-in method/);
    expect(describeAuthError("account not linked")).toMatch(/different sign-in method/);
  });

  it("passes other messages through", () => {
    expect(describeAuthError("Invalid email or password")).toBe("Invalid email or password");
  });
});

describe("takeAuthErrorFromUrl", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("reads and clears the OAuth error code", () => {
    window.history.replaceState(null, "", "/?error=account_not_linked&keep=1");
    expect(takeAuthErrorFromUrl()).toMatch(/different sign-in method/);
    expect(window.location.search).toBe("?keep=1");
  });

  it("returns null when there is no error", () => {
    expect(takeAuthErrorFromUrl()).toBeNull();
  });
});
