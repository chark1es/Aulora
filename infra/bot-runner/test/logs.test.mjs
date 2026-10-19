import assert from "node:assert/strict";
import { test } from "node:test";
import { clipLine, createLineBuffer, createLogShipper } from "../src/logs.mjs";

test("clipLine keeps short lines and clips long ones to bytes", () => {
  assert.equal(clipLine("hello"), "hello");
  const long = "x".repeat(5000);
  const clipped = clipLine(long, 4096);
  assert.equal(Buffer.byteLength(clipped, "utf8"), 4096);
});

test("createLineBuffer splits lines, handles CRLF, and flushes a partial line", () => {
  const lines = [];
  const buffer = createLineBuffer((line) => lines.push(line));
  buffer.push(Buffer.from("one\ntwo\r\nthr"));
  buffer.push(Buffer.from("ee\npartial"));
  assert.deepEqual(lines, ["one", "two", "three"]);
  buffer.flush();
  assert.deepEqual(lines, ["one", "two", "three", "partial"]);
});

test("createLineBuffer bounds a runaway line with no newline", () => {
  const lines = [];
  const buffer = createLineBuffer((line) => lines.push(line), 1024);
  buffer.push(Buffer.from("y".repeat(10000)));
  assert.ok(lines.length >= 2, "a huge line is emitted in bounded chunks");
});

test("createLogShipper batches, clips, and flushes on a timer", async () => {
  const batches = [];
  const shipper = createLogShipper({
    post: async (botId, lines) => batches.push({ botId, lines }),
    flushIntervalMs: 10,
    maxBatchLines: 5,
    maxLineBytes: 4096,
  });

  for (let index = 0; index < 7; index += 1) {
    shipper.add("bot_a", "stdout", `line-${index}`);
  }
  shipper.add("bot_a", "stderr", "z".repeat(9000));

  await new Promise((resolve) => setTimeout(resolve, 50));
  shipper.stop();

  const flat = batches.flatMap((batch) => batch.lines);
  assert.equal(flat.length, 8);
  assert.ok(batches[0].lines.length <= 5, "first batch is capped at maxBatchLines");
  assert.ok(batches.every((batch) => batch.lines.length <= 5));
  for (const line of flat) {
    assert.ok(Buffer.byteLength(line.text, "utf8") <= 4096);
  }
  assert.ok(flat.every((line) => typeof line.at === "number"));
  assert.ok(flat.every((line) => line.stream === "stdout" || line.stream === "stderr"));
});

test("createLogShipper does not call post when nothing was added", async () => {
  let calls = 0;
  const shipper = createLogShipper({
    post: async () => {
      calls += 1;
    },
    flushIntervalMs: 5,
  });
  shipper.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
});
