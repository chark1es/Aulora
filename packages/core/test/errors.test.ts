import { describe, expect, it } from "vitest";
import { classifyError, isAuthenticationError } from "../src/index.js";

describe("classifyError", () => {
  it("treats a dropped connection as reconnecting", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe("reconnecting");
    expect(classifyError(new Error("WebSocket closed"))).toBe("reconnecting");
  });

  it("treats a not-yet-authenticated Convex error as reconnecting", () => {
    expect(isAuthenticationError("Not authenticated")).toBe(true);
    expect(classifyError(new Error("Uncaught ConvexError: Not authenticated"))).toBe(
      "reconnecting",
    );
  });

  it("treats a server rejection as fatal", () => {
    expect(isAuthenticationError("Invalid channel name")).toBe(false);
    expect(classifyError(new Error("Invalid channel name"))).toBe("fatal");
    expect(classifyError(undefined)).toBe("fatal");
  });
});
