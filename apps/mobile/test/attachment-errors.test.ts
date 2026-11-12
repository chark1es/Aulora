import { messageSendError } from "@aulora/core";
import { expect, it } from "vitest";
import { attachmentUploadErrorMessage } from "../src/lib/attachment-errors";

it("names upload size and connection failures and preserves safe send fallbacks", () => {
  expect(attachmentUploadErrorMessage(new Error("upload size cap: 26214400 bytes"))).toBe(
    "That file is over the upload size limit (25 MiB).",
  );
  expect(attachmentUploadErrorMessage(new Error("HTTP 413"))).toBe(
    "That file is over the upload size limit.",
  );
  expect(attachmentUploadErrorMessage(new Error("Network request failed"))).toContain(
    "Couldn’t reach the workspace to upload that attachment.",
  );
  const cause = new Error("Permission denied");
  expect(attachmentUploadErrorMessage(cause, messageSendError(cause))).toBe(
    "You don’t have permission to send messages here.",
  );
});
