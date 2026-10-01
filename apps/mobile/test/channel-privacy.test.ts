import { ConvexReactClient } from "convex/react";
import { expect, it, vi } from "vitest";
import { convexPort } from "../src/lib/convex-chat";

it("never retries a private channel request as a public channel", async () => {
  const client = new ConvexReactClient("https://example.convex.cloud");
  const mutation = vi
    .spyOn(client, "mutation")
    .mockRejectedValue(
      new Error("Object contains extra field `private` that is not in the validator"),
    );
  await expect(
    convexPort(client).createChannel({ kind: "text", name: "private-planning", private: true }),
  ).rejects.toThrow("private");
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[0]?.[1]).toMatchObject({ private: true });
  await client.close();
});
