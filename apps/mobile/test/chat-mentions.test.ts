import { ConvexReactClient } from "convex/react";
import { expect, it, vi } from "vitest";
import { convexPort } from "../src/lib/convex-chat";

it("forwards every mention kind to messages.send", async () => {
  const client = new ConvexReactClient("https://example.convex.cloud");
  vi.spyOn(client, "query").mockResolvedValue({} as never);
  const mutation = vi.spyOn(client, "mutation").mockResolvedValue("message-id");
  await convexPort(client).sendMessage({
    channelId: "channel",
    body: "Hello",
    mentionUserIds: ["user"],
    mentionChannelIds: ["channel-mention"],
    mentionCategoryIds: ["category"],
    mentionRoleIds: ["role"],
  });
  expect(mutation.mock.calls[0]?.[1]).toMatchObject({
    channelId: "channel",
    body: "Hello",
    mentionUserIds: ["user"],
    mentionChannelIds: ["channel-mention"],
    mentionCategoryIds: ["category"],
    mentionRoleIds: ["role"],
  });
  await client.close();
});
