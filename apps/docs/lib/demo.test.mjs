import assert from "node:assert/strict";
import { test } from "node:test";
import { replyFor } from "../static/demo.js";

test("demo replies stay in the workspace you wrote to", () => {
  assert.equal(replyFor("acme-studio", "ops", "where is the backup key?", 0).user, "u-jacob");
  assert.equal(replyFor("lumen", "notes", "I pasted the token", 0).user, "u-wade");
  assert.equal(replyFor("makers", "general", "see you there", 0).user, "u-theresa");
  assert.equal(replyFor("acme-studio", "design", "spacing", 0).user, "u-kathryn");
});
