import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDebugLog,
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_ENTRIES,
  debugLog,
  generateDebugTestError,
  installDebugConsole,
  redactDebugText,
} from "../src/debug-log";

afterEach(() => {
  debugLog.clear();
});

describe("debug logs", () => {
  it("evicts oldest entries at the count cap and reports dropped entries", () => {
    const log = createDebugLog();
    for (let i = 0; i < 230; i++) log.record("test", `error ${i}`);
    expect(log.snapshot()).toHaveLength(DEBUG_LOG_MAX_ENTRIES);
    expect(log.snapshot()[0]?.detail).toBe("error 30");
    expect(JSON.parse(log.report("test", "steps")).dropped).toBe(30);
  });

  it("bounds oversized and non-ASCII errors by bytes as well as count", () => {
    const log = createDebugLog();
    for (let i = 0; i < 200; i++) log.record("test", "錯".repeat(100_000));
    expect(new TextEncoder().encode(JSON.stringify(log.snapshot())).length).toBeLessThanOrEqual(
      DEBUG_LOG_MAX_BYTES,
    );
    expect(log.snapshot().length).toBeLessThan(200);
    expect(log.snapshot()[0]?.detail.length).toBeLessThanOrEqual(8000);
  });

  it("captures stacks without traversing arbitrary objects or invoking getters", () => {
    const log = createDebugLog();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    Object.defineProperty(circular, "password", {
      get() {
        throw new Error("getter invoked");
      },
    });
    log.record("boundary", new Error("example"), circular);
    expect(log.snapshot()[0]?.detail).toContain("Error: example");
    expect(log.snapshot()[0]?.detail).toContain("[Object omitted]");
  });

  it("redacts common secrets from errors and reproduction notes", () => {
    const secret =
      'https://example.test/callback?code=private#token=secret Bearer abc123 password="private" token=secret eyJhbGci.eyJzdWI.signature';
    const log = createDebugLog();
    log.record("test", secret);
    const report = log.report("test", secret);
    expect(report).not.toContain("private");
    expect(report).not.toContain("abc123");
    expect(report).not.toContain("eyJhbGci");
    expect(redactDebugText("aulora://auth/callback?code=private")).not.toContain("private");
    expect(redactDebugText("https://user:private@example.test/path")).not.toContain("private");
    expect(redactDebugText("access_token=private refresh_token=private")).not.toContain("private");
    expect(redactDebugText(secret)).toContain("https://example.test/callback");
  });

  it("scrubs complete credential headers and quoted values cut off by limits", () => {
    const log = createDebugLog();
    for (const text of [
      "Authorization: Basic dXNlcjpwYXNz",
      "Cookie: theme=dark; session=private-session",
      "Set-Cookie: session=private-session; HttpOnly",
      `${"x".repeat(7950)} password="private hello private world ${"z".repeat(100)}"`,
      `${"x".repeat(7950)} password='private hello private world ${"z".repeat(100)}'`,
    ]) {
      log.record("test", text);
      expect(JSON.stringify(log.snapshot())).not.toContain("private");
      expect(log.report("test", text)).not.toContain("private");
      expect(log.report("test", text)).not.toContain("dXNlcjpwYXNz");
    }
  });

  it("notifies subscribers, preserves snapshot identity between writes, and clears", () => {
    const log = createDebugLog();
    const listener = vi.fn();
    const stop = log.subscribe(listener);
    expect(log.snapshot()).toBe(log.snapshot());
    log.record("test", "failure");
    expect(listener).toHaveBeenCalledTimes(1);
    log.clear();
    expect(log.snapshot()).toHaveLength(0);
    expect(JSON.parse(log.report("client 1", "1. Click test")).reproduction).toBe("1. Click test");
    stop();
    log.record("test", "another");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("captures console errors and warnings once while retaining original output", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installDebugConsole();
    installDebugConsole();
    generateDebugTestError();
    console.warn("warning");
    expect(debugLog.snapshot()).toHaveLength(2);
    expect(debugLog.snapshot()[0]?.detail).toContain("Aulora diagnostic test error");
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    error.mockRestore();
    warn.mockRestore();
  });
});
