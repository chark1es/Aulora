import { debugLog } from "@aulora/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugLogsSection } from "../components/chat/DebugLogsSection";
import "../lib/debug-log";

afterEach(() => {
  act(() => {
    debugLog.clear();
  });
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

  it("shows recorded errors newest first, exports steps and clears the log", async () => {
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
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(document.body.contains(this)).toBe(true);
    });
    const report = vi.spyOn(debugLog, "report");
    render(<DebugLogsSection />);
    expect(screen.getByText("No errors or warnings have been recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate test error" })).not.toBeInTheDocument();
    act(() => {
      debugLog.record("window.error", new Error("earlier failure"));
      debugLog.record("console.warn", new Error("newer warning"));
    });
    expect(screen.getByText("2 entries recorded")).toBeInTheDocument();
    const items = within(
      screen.getByRole("list", { name: "Recorded errors and warnings" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("console.warn");
    expect(items[0]).toHaveTextContent("newer warning");
    expect(items[1]).toHaveTextContent("window.error");
    await user.type(screen.getByLabelText("Steps to reproduce"), "1. Open settings");
    await user.click(screen.getByRole("button", { name: "Download debug report" }));
    expect(click).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("web/desktop"), "1. Open settings");
    expect(createURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(JSON.parse(debugLog.report("test", "1. Open settings")).entries[0].detail).toContain(
      "earlier failure",
    );
    await user.click(screen.getByRole("button", { name: "Clear logs" }));
    expect(screen.getByText("0 entries recorded")).toBeInTheDocument();
    expect(screen.getByText("No errors or warnings have been recorded yet.")).toBeInTheDocument();
    act(() => {
      debugLog.clear();
    });
  });

  it("shows the newest entries when the buffer holds more than the display limit", () => {
    act(() => {
      for (let index = 0; index < 55; index++) {
        debugLog.record("test", `entry ${index}`);
      }
    });
    render(<DebugLogsSection />);
    expect(screen.getByText("Showing the newest 50 of 55 entries.")).toBeInTheDocument();
    const items = within(
      screen.getByRole("list", { name: "Recorded errors and warnings" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(50);
    expect(items[0]).toHaveTextContent("entry 54");
    expect(screen.queryByText("entry 0")).not.toBeInTheDocument();
  });
});
