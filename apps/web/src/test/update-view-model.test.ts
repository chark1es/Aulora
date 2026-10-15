import { describe, expect, it } from "vitest";
import {
  downloadLabel,
  downloadPercent,
  formatBytes,
  formatCheckedAt,
  formatReleaseDate,
  primaryAction,
  statusText,
  versionTransition,
} from "../components/updateViewModel";

describe("update view model", () => {
  it("formats a version transition badge", () => {
    expect(versionTransition("1.1.0", "1.2.0")).toBe("v1.1.0 → v1.2.0");
    expect(versionTransition("1.2.0", "1.2.0")).toBe("v1.2.0");
    expect(versionTransition(null, "1.2.0")).toBe("v1.2.0");
    expect(versionTransition("1.1.0", null)).toBeNull();
  });

  it("computes determinate and indeterminate download progress", () => {
    expect(downloadPercent({ downloaded: 50, contentLength: 100 })).toBe(50);
    expect(downloadPercent({ downloaded: 250, contentLength: 100 })).toBe(100);
    expect(downloadPercent({ downloaded: 50, contentLength: null })).toBeNull();
    expect(downloadPercent(null)).toBeNull();
    expect(downloadLabel({ downloaded: 50, contentLength: 100 })).toBe("50% downloaded");
    expect(downloadLabel({ downloaded: 2 * 1024 * 1024, contentLength: null })).toBe(
      "2.0 MB downloaded",
    );
  });

  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(512)).toBe("0.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });

  it("formats readable release and check times", () => {
    expect(formatReleaseDate("2024-03-05T10:00:00.000Z")).toContain("2024");
    expect(formatReleaseDate("not a date")).toBeNull();
    expect(formatReleaseDate(null)).toBeNull();
    expect(formatCheckedAt(null)).toBeNull();
    expect(formatCheckedAt(1_700_000_000_000)).toBeTruthy();
  });

  it("describes each state", () => {
    const base = {
      available: false,
      ready: false,
      latestVersion: "1.2.0",
      checked: false,
      installDirectly: false,
    };
    expect(statusText({ ...base, phase: "checking", checked: false })).toBe(
      "Checking for updates…",
    );
    expect(statusText({ ...base, phase: "downloading" })).toBe("Downloading update…");
    expect(statusText({ ...base, phase: "restarting", installDirectly: true })).toBe(
      "Installing the update…",
    );
    expect(statusText({ ...base, phase: "idle", available: true })).toBe("v1.2.0 is available.");
    expect(statusText({ ...base, phase: "idle", ready: true })).toBe("v1.2.0 is ready to install.");
    expect(statusText({ ...base, phase: "idle", checked: true })).toBe(
      "You’re on the latest version.",
    );
    expect(statusText({ ...base, phase: "idle" })).toBe("Check for a new release.");
  });

  describe("primary action", () => {
    type ActionState = Parameters<typeof primaryAction>[0];
    const idle: ActionState = {
      phase: "idle",
      available: false,
      ready: false,
      installDirectly: false,
      error: null,
    };

    it("shows progress while downloading", () => {
      const state = { ...idle, phase: "downloading", available: true } as const;
      expect(primaryAction(state)).toEqual({ label: "Downloading…", kind: "download", busy: true });
    });

    it("offers the update when one is available", () => {
      const action = primaryAction({ ...idle, available: true });
      expect(action).toEqual({ label: "Update now", kind: "download", busy: false });
    });

    it("asks for a restart once the update is ready", () => {
      const state = { ...idle, phase: "ready", available: true, ready: true } as const;
      expect(primaryAction(state)).toEqual({
        label: "Restart to finish",
        kind: "restart",
        busy: false,
      });
    });

    it("installs directly when the host updates in place", () => {
      const action = primaryAction({ ...idle, available: true, installDirectly: true });
      expect(action).toEqual({ label: "Install update", kind: "install", busy: false });
    });

    it("offers a retry after an error", () => {
      expect(primaryAction({ ...idle, error: "Failed." })).toEqual({
        label: "Retry",
        kind: "check",
        busy: false,
      });
    });

    it("offers nothing when there is nothing to do", () => {
      expect(primaryAction(idle)).toBeNull();
    });
  });
});
