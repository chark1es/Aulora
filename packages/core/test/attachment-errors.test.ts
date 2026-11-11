import { expect, it } from "vitest";
import { AttachmentSizeError, attachmentUploadErrorMessage, messageSendError } from "../src/index";

it("preserves the web preflight size message", () => {
  expect(attachmentUploadErrorMessage(new AttachmentSizeError("clip.mov", 2000, 1000))).toBe(
    "clip.mov is 2.0 KiB, over the 1000 B limit.",
  );
});

it.each([
  [
    new Error("upload size cap: 26214400 bytes"),
    "That file is over the upload size limit (25 MiB).",
  ],
  [new Error("HTTP 413"), "That file is over the upload size limit."],
  ["request entity too large", "That file is over the upload size limit."],
  [
    new TypeError("Failed to fetch"),
    "Couldn’t reach the workspace to upload that attachment. Check your connection and try again.",
  ],
  [
    new Error("Network request failed"),
    "Couldn’t reach the workspace to upload that attachment. Check your connection and try again.",
  ],
  [new Error("Upload failed (HTTP 500)"), "Couldn’t upload that attachment."],
  [null, "Couldn’t upload that attachment."],
])("classifies upload failure %s", (error, expected) => {
  expect(attachmentUploadErrorMessage(error)).toBe(expected);
});

it("preserves a safe send fallback", () => {
  const error = new Error("Permission denied");
  expect(attachmentUploadErrorMessage(error, messageSendError(error))).toBe(
    "You don’t have permission to send messages here.",
  );
});
