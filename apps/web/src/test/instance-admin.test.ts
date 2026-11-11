import { describe, expect, it } from "vitest";
import {
  backupStatusLabel,
  backupStatusTone,
  composeByteSize,
  formatQuota,
  formatTimestamp,
  licenseStateLabel,
  licenseStateTone,
  splitByteSize,
} from "../lib/instance-admin";

describe("formatQuota", () => {
  it("calls zero unlimited and passes through sizes", () => {
    expect(formatQuota(0)).toBe("Unlimited");
    expect(formatQuota(1024)).toBe("1.0 KiB");
  });
});

describe("splitByteSize", () => {
  it("renders zero as unlimited in GiB", () => {
    expect(splitByteSize(0)).toEqual({ value: "0", unit: "GiB" });
    expect(splitByteSize(-5)).toEqual({ value: "0", unit: "GiB" });
  });

  it("picks the largest exact unit", () => {
    expect(splitByteSize(1024)).toEqual({ value: "1", unit: "KiB" });
    expect(splitByteSize(1536)).toEqual({ value: "1.5", unit: "KiB" });
    expect(splitByteSize(25 * 1024 * 1024)).toEqual({ value: "25", unit: "MiB" });
    expect(splitByteSize(2 * 1024 ** 3)).toEqual({ value: "2", unit: "GiB" });
    expect(splitByteSize(1024 ** 4)).toEqual({ value: "1", unit: "TiB" });
    expect(splitByteSize(2 * 1024 ** 4)).toEqual({ value: "2", unit: "TiB" });
  });

  it("falls back to KiB below one unit", () => {
    expect(splitByteSize(500)).toEqual({ value: "0.48828125", unit: "KiB" });
  });
});

describe("composeByteSize", () => {
  it("composes integer bytes from a number and unit", () => {
    expect(composeByteSize("0", "GiB")).toBe(0);
    expect(composeByteSize("1", "KiB")).toBe(1024);
    expect(composeByteSize("25", "MiB")).toBe(25 * 1024 * 1024);
    expect(composeByteSize("2.5", "GiB")).toBe(2.5 * 1024 ** 3);
    expect(composeByteSize("1", "TiB")).toBe(1024 ** 4);
  });

  it("rejects empty, negative and non-numeric input", () => {
    expect(composeByteSize("", "MiB")).toBeNull();
    expect(composeByteSize("   ", "MiB")).toBeNull();
    expect(composeByteSize("abc", "MiB")).toBeNull();
    expect(composeByteSize("-1", "KiB")).toBeNull();
    expect(composeByteSize("1,000", "KiB")).toBeNull();
  });

  it("round-trips through splitByteSize", () => {
    for (const bytes of [0, 1024, 1536, 500 * 1024, 25 * 1024 * 1024, 2 * 1024 ** 3, 1024 ** 4]) {
      const { value, unit } = splitByteSize(bytes);
      expect(composeByteSize(value, unit)).toBe(bytes);
    }
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
