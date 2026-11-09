import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logBoot, redactLocationHref } from "./remount-debug";

describe("redactLocationHref", () => {
  it("keeps only the origin and path", () => {
    expect(
      redactLocationHref(
        "https://chat.example.com/chat?code=secret&state=abc#aulora-auth-code=handoff&aulora-auth-error=oops",
      ),
    ).toBe("https://chat.example.com/chat");
    expect(redactLocationHref("not a url")).toBe("");
    expect(redactLocationHref(undefined)).toBe("");
  });
});

describe("logBoot", () => {
  beforeEach(() => {
    localStorage.setItem("aulora.debug.remount", "1");
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("never copies handoff parameters into the log", () => {
    window.history.replaceState(
      null,
      "",
      "/chat?code=secret&state=state-secret#aulora-auth-code=handoff-secret&aulora-auth-server=https%3A%2F%2Fchat.example.com",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logBoot("web");

    const line = String(warn.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("/chat");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("aulora-auth");
    expect(line).not.toContain("state=");
  });
});
