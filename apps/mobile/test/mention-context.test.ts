import { expect, it } from "vitest";

// Raw source imports (as in mobile-layout.test.ts) keep this scan typed without node:fs.
const sources = import.meta.glob(
  [
    "../src/components/chat/ThreadModal.tsx",
    "../src/components/chat/ChatScreenSheets.tsx",
    "../src/lib/outbox-send.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const readSource = (path: string): string => sources[`../${path}`] ?? "";

it("uses the shared reply-first channel-copy implementation", () => {
  const source = readSource("src/components/chat/ThreadModal.tsx");
  const handler = readSource("src/components/chat/ChatScreenSheets.tsx");
  expect(source).toContain('Also send to {channelTitle ?? "the conversation"}');
  expect(handler).toContain("await sendThreadReply(");
  expect(handler).toContain("threadRootId, ...options");
  expect(handler).toContain("attachments: []");
  expect(handler).toContain("canMentionEveryone: false");
});
it("mobile outbox replay sends through the session without compose-time confirmation", () => {
  const source = readSource("src/lib/outbox-send.ts");
  expect(source).toContain("session.sendMessage(");
  expect(source).not.toMatch(/confirm|Composer/);
});
