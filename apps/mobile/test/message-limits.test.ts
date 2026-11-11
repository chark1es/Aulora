import { describe, expect, it } from "vitest";
import {
  attachmentRoom,
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_MAX_LENGTH,
  messageLimitError,
} from "../src/lib/message-limits";

describe("message limits", () => {
  it("matches the server's 4000 character and 10 attachment limits", () => {
    expect(MESSAGE_MAX_LENGTH).toBe(4000);
    expect(MESSAGE_MAX_ATTACHMENTS).toBe(10);
    expect(messageLimitError("a".repeat(4000), 10)).toBeNull();
  });

  it("rejects text over the character limit", () => {
    expect(messageLimitError("a".repeat(4001), 0)).toBe(
      "Message is over 4,000 characters. Trim it or split it.",
    );
  });

  it("rejects more attachments than the server accepts", () => {
    expect(messageLimitError("hello", 11)).toContain("10");
    expect(messageLimitError("hello", 10)).toBeNull();
  });

  it("reports how many more files may be attached", () => {
    expect(attachmentRoom(0)).toBe(MESSAGE_MAX_ATTACHMENTS);
    expect(attachmentRoom(7)).toBe(3);
    expect(attachmentRoom(10)).toBe(0);
    expect(attachmentRoom(12)).toBe(0);
  });
});
