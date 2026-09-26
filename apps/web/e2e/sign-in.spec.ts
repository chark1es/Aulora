import { test } from "@playwright/test";
import { connectAndSignIn, hasOwnerCredentials } from "./helpers";

/**
 * First-run happy path against a real self-hosted stack:
 * connect by URL -> read /.well-known/aulora.json -> sign in with the owner
 * account -> land on the signed-in shell (workspace/server rail).
 *
 * Credentials come from the environment and are never committed.
 */
test.describe("connect and sign in", () => {
  test("connects by URL, signs in as the owner and shows the shell", async ({ page }) => {
    test.skip(!hasOwnerCredentials, "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD");

    // The signed-in shell exists with zero channels, so asserting the rail
    // (not `message-list`) keeps this spec correct on a fresh workspace.
    await connectAndSignIn(page);
  });
});
