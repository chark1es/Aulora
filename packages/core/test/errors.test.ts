import { describe, expect, it } from "vitest";
import {
  classifyError,
  isAuthenticationError,
  messageSendError,
  userFacingError,
} from "../src/index.js";

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

describe("userFacingError", () => {
  it("passes through an app-authored ConvexError string", () => {
    const error = new Error("This board has reached its 500-card limit");
    error.name = "ConvexError";
    Object.assign(error, { data: "This board has reached its 500-card limit" });
    expect(userFacingError(error)).toBe("This board has reached its 500-card limit");
  });

  it("hides transport and internal messages behind the fallback", () => {
    expect(userFacingError(new Error("Failed to fetch"))).toBe("Something went wrong. Try again.");
    expect(userFacingError(new Error("   "))).toBe("Something went wrong. Try again.");
    expect(userFacingError(undefined)).toBe("Something went wrong. Try again.");
  });

  it("accepts a context-specific fallback", () => {
    expect(userFacingError("boom", "Try again in a moment.")).toBe("Try again in a moment.");
  });
});

it("shows safe send details and hides internal errors", () => {
  expect(messageSendError(new Error("permission denied: private SQL"))).toBe(
    "You don’t have permission to send messages here.",
  );
  expect(messageSendError(new Error("Failed to fetch"))).toContain("Check your connection");
  expect(messageSendError(new Error("Upload failed"))).toBe(
    "Message not sent. Your text is still here.",
  );
  expect(messageSendError(new Error("private stack trace"))).not.toContain("private");
  const error = Object.assign(new Error("internal"), {
    name: "ConvexError",
    data: "Channel is read-only",
  });
  expect(messageSendError(error)).toBe("Channel is read-only");
});
