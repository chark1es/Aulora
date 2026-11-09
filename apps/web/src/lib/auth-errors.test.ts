import { afterEach, describe, expect, it } from "vitest";
import { describeAuthError, takeAuthErrorFromUrl } from "./auth-errors";

describe("describeAuthError", () => {
  it("keeps the specific copy for the client's own exchange timeout", () => {
    expect(describeAuthError("Sign-in timed out, please try again")).toBe(
      "Sign-in timed out, please try again",
    );
  });

  it("explains a sign-up with an email that already has an account", () => {
    expect(describeAuthError("User already exists. Use another email.")).toMatch(
      /already exists for this email/,
    );
  });

  it("explains an OAuth sign-in the server would not link", () => {
    expect(describeAuthError("account_not_linked")).toMatch(/different sign-in method/);
    expect(describeAuthError("account not linked")).toMatch(/different sign-in method/);
  });

  it("explains an expired or cancelled OAuth sign-in", () => {
    expect(describeAuthError("state_mismatch")).toMatch(/expired before it finished/);
    expect(describeAuthError("auth_cancelled")).toMatch(/cancelled/);
    expect(describeAuthError("auth_expired")).toBe("Sign-in took too long, please try again.");
  });

  it("passes known local form validation through", () => {
    expect(describeAuthError("Invalid email or password")).toBe("Invalid email or password");
  });

  it("returns only the canonical message when a safe phrase is embedded in crafted text", () => {
    expect(
      describeAuthError(
        "invalid email or password. Account locked, call 555-0100 or visit https://evil.example",
      ),
    ).toBe("Invalid email or password");
  });

  it("never echoes an unknown provider or handoff message", () => {
    expect(describeAuthError("<img src=x onerror=alert(1)>")).toMatch(
      /Sign-in could not be completed/,
    );
    expect(describeAuthError("auth_failed")).toMatch(/Sign-in could not be completed/);
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
