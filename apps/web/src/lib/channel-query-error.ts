import { ConvexError } from "convex/values";

/** Access loss closes a channel instead of taking down the signed-in app. */
export function isClosedChannelError(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    (error.data === "Missing permission" ||
      error.data === "Channel not found" ||
      error.data === "Not a channel member")
  );
}
