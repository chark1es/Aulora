import { BOT_LIMITS } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  BOT_RUNNER_OFFLINE_MESSAGE,
  botFileBytes,
  botFilesLimitError,
  botStatusMeta,
  filesDiff,
  formatBytes,
  validateBotDescription,
  validateBotEnvName,
  validateBotName,
  validateBotPath,
} from "../components/admin/bots/bot-format";

describe("bot-format", () => {
  it("labels every bot status", () => {
    expect(botStatusMeta("running").label).toBe("Running");
    expect(botStatusMeta("crashed").label).toBe("Crashed");
    expect(botStatusMeta("stopped").label).toBe("Stopped");
    expect(botStatusMeta("starting").label).toBe("Starting");
    expect(BOT_RUNNER_OFFLINE_MESSAGE).toContain("docker compose --profile bots up -d");
  });

  it("validates names and descriptions against the limits", () => {
    expect(validateBotName("")).toBe("Give the bot a name");
    expect(validateBotName("  ")).toBe("Give the bot a name");
    expect(validateBotName("a".repeat(BOT_LIMITS.maxNameLength))).toBeNull();
    expect(validateBotName("a".repeat(BOT_LIMITS.maxNameLength + 1))).toContain("at most");
    expect(validateBotName("Helper")).toBeNull();
    expect(validateBotDescription("x".repeat(BOT_LIMITS.maxDescriptionLength + 1))).toContain(
      "at most",
    );
  });

  it("accepts relative source paths and rejects unsafe ones", () => {
    expect(validateBotPath("main.ts")).toBeNull();
    expect(validateBotPath("lib/util.test.ts")).toBeNull();
    expect(validateBotPath("")).toContain("1 to");
    expect(validateBotPath("/etc/passwd")).toContain("relative");
    expect(validateBotPath(".env")).toContain("relative");
    expect(validateBotPath("src/../secret.ts")).toContain("'..'");
    expect(validateBotPath("node_modules/pkg/index.js")).toContain("node_modules");
    expect(validateBotPath("a b.ts")).toContain("may only contain");
    expect(validateBotPath("utils.ts", ["utils.ts"])).toContain("already exists");
  });

  it("validates environment names and reserves the AULORA_ prefix", () => {
    expect(validateBotEnvName("API_KEY")).toBeNull();
    expect(validateBotEnvName("lower")).toContain("[A-Z_]");
    expect(validateBotEnvName("AULORA_TOKEN")).toContain("AULORA_");
  });

  it("measures UTF-8 bytes and formats sizes", () => {
    expect(botFileBytes("abc")).toBe(3);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
  });

  it("diffs only changed upserts and the deleted paths", () => {
    const original = [
      { path: "main.ts", content: "a" },
      { path: "old.ts", content: "b" },
    ];
    const draft = [
      { path: "main.ts", content: "a" },
      { path: "new.ts", content: "c" },
    ];
    const diff = filesDiff(original, draft);
    expect(diff.upserts).toEqual([{ path: "new.ts", content: "c" }]);
    expect(diff.deletePaths).toEqual(["old.ts"]);
    expect(diff.dirty).toBe(true);
    expect(filesDiff(original, original).dirty).toBe(false);
  });

  it("flags files that break the per-file and total limits", () => {
    const tooBig = [{ path: "big.ts", content: "x".repeat(BOT_LIMITS.maxFileBytes + 1) }];
    expect(botFilesLimitError(tooBig)).toContain("big.ts");
    expect(botFilesLimitError([{ path: "main.ts", content: "ok" }])).toBeNull();
  });
});
