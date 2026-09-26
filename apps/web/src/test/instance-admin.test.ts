import { describe, expect, it } from "vitest";
import {
  backupStatusLabel,
  backupStatusTone,
  formatBytes,
  formatQuota,
  formatTimestamp,
  licenseStateLabel,
  licenseStateTone,
  parseByteInput,
} from "../lib/instance-admin";

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MiB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GiB");
  });

  it("treats bad input as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatQuota", () => {
  it("calls zero unlimited and passes through sizes", () => {
    expect(formatQuota(0)).toBe("Unlimited");
    expect(formatQuota(1024)).toBe("1.0 KiB");
  });
});

describe("parseByteInput", () => {
  it("parses sizes and units", () => {
    expect(parseByteInput("500")).toBe(500);
    expect(parseByteInput("1kb")).toBe(1000);
    expect(parseByteInput("25 MiB")).toBe(25 * 1024 * 1024);
    expect(parseByteInput("2GiB")).toBe(2 * 1024 * 1024 * 1024);
    expect(parseByteInput("0.5 MiB")).toBe(512 * 1024);
  });

  it("rejects empty, zero and unknown units", () => {
    expect(parseByteInput("")).toBeNull();
    expect(parseByteInput("0")).toBeNull();
    expect(parseByteInput("nope")).toBeNull();
    expect(parseByteInput("5 furlongs")).toBeNull();
  });
});

describe("labels and tones", () => {
  it("labels license states", () => {
    expect(licenseStateLabel("unlicensed")).toBe("Unlicensed");
    expect(licenseStateLabel("active")).toBe("Active");
    expect(licenseStateTone("active")).toBe("secondary");
    expect(licenseStateTone("invalid")).toBe("danger");
    expect(licenseStateTone("unlicensed")).toBe("accent");
  });

  it("labels backup statuses", () => {
    expect(backupStatusLabel("succeeded")).toBe("Succeeded");
    expect(backupStatusLabel("requested")).toBe("Requested");
    expect(backupStatusTone("failed")).toBe("danger");
    expect(backupStatusTone("running")).toBe("accent");
  });
});

describe("formatTimestamp", () => {
  it("renders a deterministic UTC string", () => {
    expect(formatTimestamp(Date.UTC(2026, 8, 26, 3, 5))).toBe("2026-09-26 03:05 UTC");
  });
});
