import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { acquireWatcherLock } from "./lock.mjs";
import { watcherService } from "./service.mjs";

describe("macOS update service", () => {
  it("recovers a crashed watcher and refuses to replace a live watcher", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "aulora-lock-"));
    const lock = resolve(directory, "lock");
    try {
      const release = acquireWatcherLock(lock);
      expect(() => acquireWatcherLock(lock)).toThrow("already running");
      release();
      mkdirSync(lock);
      writeFileSync(resolve(lock, "pid"), "2147483647\n");
      const recovered = acquireWatcherLock(lock);
      expect(Number(readFileSync(resolve(lock, "pid"), "utf8"))).toBe(process.pid);
      recovered();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("runs the exact checkout and Bun executable with Docker's PATH, without storing secrets", () => {
    const service = watcherService({
      dockerDir: "/Users/example/Team & Chat/infra/docker",
      bunPath: "/opt/homebrew/bin/bun",
      userHome: "/Users/example",
      path: "/Users/example/.docker/bin:/opt/homebrew/bin:/usr/bin",
    });
    expect(service.plist).toContain("Team &amp; Chat/infra/docker/update/host.mjs");
    expect(service.plist).toContain("<string>/opt/homebrew/bin/bun</string>");
    expect(service.plist).toContain(".docker/bin:/opt/homebrew/bin:/usr/bin");
    expect(service.plist).toContain("<key>KeepAlive</key><true/>");
    expect(service.plist).not.toContain("TOKEN");
    expect(service.plistPath).toContain("/Library/LaunchAgents/io.aulora.updater.");
    const other = watcherService({
      dockerDir: "/another/checkout/infra/docker",
      bunPath: "/bin/bun",
      userHome: "/Users/example",
      path: "/usr/bin",
    });
    expect(other.label).not.toBe(service.label);
  });
});
