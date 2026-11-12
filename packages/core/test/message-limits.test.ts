import { expect, it } from "vitest";
import { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_LENGTH } from "../src";

it("exports the server message limits for clients", () => {
  expect(MESSAGE_MAX_LENGTH).toBe(4000);
  expect(MESSAGE_MAX_ATTACHMENTS).toBe(10);
});
