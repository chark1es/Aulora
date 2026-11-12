import { expect, it, vi } from "vitest";
import { sendThreadReply } from "../lib/send-thread-reply";

it("accepts a persisted reply when its channel copy fails", async () => {
  const reply = vi.fn(async () => "reply");
  const error = new Error("copy failed");
  const onError = vi.fn();
  await expect(
    sendThreadReply(
      reply,
      async () => {
        throw error;
      },
      onError,
    ),
  ).resolves.toBeUndefined();
  expect(reply).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(error);
});

it("rejects a failed reply without attempting its channel copy", async () => {
  const copy = vi.fn();
  const error = new Error("reply failed");
  await expect(
    sendThreadReply(
      async () => {
        throw error;
      },
      copy,
      vi.fn(),
    ),
  ).rejects.toBe(error);
  expect(copy).not.toHaveBeenCalled();
});
