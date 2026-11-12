import { describe, expect, it } from "vitest";
import { authFailureDetail } from "../lib/auth-errors";

describe("authFailureDetail", () => {
  it("keeps a bounded diagnostic reason for the local report", () => {
    expect(authFailureDetail({ message: "invalid email or password" })).toBe(
      "invalid email or password",
    );
    expect(authFailureDetail({ status: 401, message: "session rejected" })).toBe(
      "status 401: session rejected",
    );
    expect(authFailureDetail(new TypeError("network request failed"))).toBe(
      "TypeError: network request failed",
    );
  });

  it("never returns an arbitrary object or an empty string", () => {
    expect(authFailureDetail({ status: 503 })).toBe("status 503");
    expect(authFailureDetail({})).toBe("Auth request failed without a message");
    expect(authFailureDetail(null)).toBe("Auth request failed without a message");
    expect(authFailureDetail(undefined)).toBe("Auth request failed without a message");
    expect(authFailureDetail("x".repeat(900)).length).toBe(500);
  });
});
