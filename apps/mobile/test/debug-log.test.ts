import { debugLog } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage } from "../src/components/chat/chat-screen-types";

const hooks = globalThis as typeof globalThis & {
  ErrorUtils?: unknown;
  HermesInternal?: unknown;
};
const originalErrorUtils = hooks.ErrorUtils;
const originalHermes = hooks.HermesInternal;
afterEach(() => {
  hooks.ErrorUtils = originalErrorUtils;
  hooks.HermesInternal = originalHermes;
  debugLog.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("handled failures", () => {
  it("formats errors without globally recording account-owned failures", () => {
    expect(errorMessage(new Error("could not send the message"))).not.toBe("");
    expect(debugLog.snapshot()).toEqual([]);
  });
});

describe("native error capture", () => {
  it("keeps the framework development rejection tracker intact", async () => {
    vi.stubGlobal("__DEV__", true);
    const enable = vi.fn();
    hooks.HermesInternal = { enablePromiseRejectionTracker: enable };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../src/lib/debug-log");
    expect(enable).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });
  it("preserves the global handler and enables release rejection capture", async () => {
    vi.stubGlobal("__DEV__", false);
    const previous = vi.fn();
    let globalHandler: (error: Error, fatal?: boolean) => void = previous;
    let rejectionHandler: (id: number, error: unknown) => void = () => {};
    hooks.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: typeof globalHandler) => {
        globalHandler = handler;
      },
    };
    hooks.HermesInternal = {
      enablePromiseRejectionTracker: (options: {
        allRejections: boolean;
        onUnhandled: typeof rejectionHandler;
      }) => {
        expect(options.allRejections).toBe(true);
        rejectionHandler = options.onUnhandled;
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../src/lib/debug-log");
    const { debugLog } = await import("@aulora/core");
    debugLog.clear();
    const error = new Error("native example");
    globalHandler(error, true);
    rejectionHandler(42, new Error("release rejection"));
    expect(previous).toHaveBeenCalledWith(error, true);
    expect(debugLog.snapshot().map((entry) => entry.source)).toEqual([
      "native.fatal",
      "console.warn",
    ]);
    expect(debugLog.snapshot()[1]?.detail).toContain("release rejection");
    expect(warn).toHaveBeenCalledOnce();
    debugLog.clear();
    warn.mockRestore();
    errorConsole.mockRestore();
  });
});
