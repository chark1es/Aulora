import { describe, expect, it } from "vitest";
import { formatBytes } from "../src/format-bytes";

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
