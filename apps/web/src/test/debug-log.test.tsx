import { debugLog } from "@aulora/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugLogsSection } from "../components/chat/DebugLogsSection";
import "../lib/debug-log";

afterEach(() => {
  debugLog.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("client diagnostics", () => {
  it("captures runtime errors and rejected promises without preventing default handling", () => {
    const error = new ErrorEvent("error", { error: new Error("uncaught example") });
    window.dispatchEvent(error);
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("rejected example") });
    window.dispatchEvent(rejection);
    expect(debugLog.snapshot().map((entry) => entry.source)).toEqual([
      "window.error",
      "unhandledrejection",
    ]);
    expect(rejection.defaultPrevented).toBe(false);
  });

  it("generates a test error, exports steps and clears the log", async () => {
    const user = userEvent.setup();
    const createURL = vi.fn((_blob: Blob) => "blob:test");
    const revokeURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createURL;
        static override revokeObjectURL = revokeURL;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const report = vi.spyOn(debugLog, "report");
    render(<DebugLogsSection />);
    await user.click(screen.getByRole("button", { name: "Generate test error" }));
    expect(screen.getByText("1 entries recorded")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Steps to reproduce"), "1. Open settings");
    await user.click(screen.getByRole("button", { name: "Download debug report" }));
    expect(click).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("web/desktop"), "1. Open settings");
    expect(createURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(JSON.parse(debugLog.report("test", "1. Open settings")).entries[0].detail).toContain(
      "intentional",
    );
    await user.click(screen.getByRole("button", { name: "Clear logs" }));
    expect(screen.getByText("0 entries recorded")).toBeInTheDocument();
    act(() => {
      debugLog.clear();
    });
  });
});
