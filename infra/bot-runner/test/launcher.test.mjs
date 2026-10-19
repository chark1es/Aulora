import assert from "node:assert/strict";
import { test } from "node:test";
import { botUidGid, resourceLimitArgs } from "../src/launcher.mjs";

const config = { botNproc: 256, botFileSizeBytes: 1024, botMemoryMb: 256, uidBase: 20000 };

test("TypeScript bots get no address-space cap because Node cannot start under one", () => {
  const args = resourceLimitArgs(config, "typescript");
  assert.deepEqual(args, ["--nproc=256", "--fsize=1024"]);
  assert.equal(
    args.some((arg) => arg.startsWith("--as")),
    false,
  );
});

test("Python bots get a generous address-space cap", () => {
  assert.ok(resourceLimitArgs(config, "python").includes(`--as=${1024 * 1024 * 1024}`));
  const large = resourceLimitArgs({ ...config, botMemoryMb: 1024 }, "python");
  assert.ok(large.includes(`--as=${4096 * 1024 * 1024}`));
});

test("uid slots are only used for a valid slot, and only as root", () => {
  assert.equal(botUidGid(config, -1), null);
  assert.equal(botUidGid(config, 1000), null);
  assert.equal(botUidGid(config, "x"), null);
});
