import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  dbNameFor,
  nextRunDelay,
  objectPrefix,
  pruneDirectory,
  prunableDirectories,
  recordArgs,
  timestamp,
} from "../backup-plan.mjs";

test("timestamp is a compact UTC run id", () => {
  assert.equal(timestamp(Date.UTC(2026, 8, 26, 3, 0, 0)), "20260926T030000Z");
});

test("dbNameFor mirrors Convex's instance naming", () => {
  assert.equal(dbNameFor("aulora"), "aulora");
  assert.equal(dbNameFor("acme-team"), "acme_team");
});

test("objectPrefix groups runs under backups/", () => {
  assert.equal(objectPrefix("20260926T030000Z"), "backups/20260926T030000Z");
});

test("nextRunDelay returns the wait until the next UTC hour", () => {
  const atMidnight = Date.UTC(2026, 8, 26, 0, 0, 0);
  assert.equal(nextRunDelay(atMidnight, 3), 3 * 60 * 60);
  const atThree = Date.UTC(2026, 8, 26, 3, 0, 0);
  assert.equal(nextRunDelay(atThree, 3), 24 * 60 * 60);
  const atFour = Date.UTC(2026, 8, 26, 4, 30, 0);
  assert.equal(nextRunDelay(atFour, 3), 22 * 60 * 60 + 30 * 60);
});

test("nextRunDelay rejects an out-of-range hour", () => {
  assert.throws(() => nextRunDelay(Date.now(), 24), RangeError);
});

test("prunableDirectories keeps the newest runs", () => {
  const entries = [
    { name: "20260924T030000Z" },
    { name: "20260926T030000Z" },
    { name: "20260925T030000Z" },
    { name: "not-a-run" },
  ];
  assert.deepEqual(prunableDirectories(entries, 2), ["20260924T030000Z"]);
  assert.deepEqual(prunableDirectories(entries, 3), []);
  assert.deepEqual(prunableDirectories(entries, 0).length, 3);
});

test("recordArgs emits JSON and omits missing optionals", () => {
  const payload = JSON.parse(
    recordArgs({ TOKEN: "abc", STATUS: "succeeded", STARTED: "1000", FINISHED: "2000", SIZE: "4096" }),
  );
  assert.deepEqual(payload, {
    token: "abc",
    status: "succeeded",
    startedAt: 1000,
    trigger: "cron",
    finishedAt: 2000,
    sizeBytes: 4096,
  });

  const failed = JSON.parse(recordArgs({ TOKEN: "abc", STATUS: "failed", STARTED: "x" }));
  assert.equal(failed.status, "failed");
  assert.equal(typeof failed.startedAt, "number");
  assert.ok(!("sizeBytes" in failed));
  assert.ok(!("location" in failed));
});

test("pruneDirectory removes old runs and keeps the newest", () => {
  const dir = mkdtempSync(join(tmpdir(), "aulora-backup-"));
  try {
    for (const name of ["20260924T030000Z", "20260925T030000Z", "20260926T030000Z"]) {
      mkdirSync(join(dir, name));
    }
    assert.deepEqual(pruneDirectory(dir, 1), ["20260924T030000Z", "20260925T030000Z"]);
    assert.deepEqual(readdirSync(dir), ["20260926T030000Z"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
