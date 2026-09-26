import { expect, test } from "@playwright/test";
import { createChannel, hasOwnerCredentials, signIn } from "./helpers";

/**
 * Phase 2, task 3a gate: two devices, one workspace owner.
 *
 * Two isolated browser contexts sign in as the same owner (two devices, each
 * with its own MLS identity in IndexedDB). Device A creates a channel and sends
 * a message; device B opens the same channel, joins its MLS group via a
 * published KeyPackage + Welcome, decrypts the ciphertext and displays the
 * plaintext. An edit, a reaction and a delete then have to be visible on both
 * devices, proving the live Convex subscriptions and the MLS ratchet work.
 *
 * This runs against a real `docker compose` stack. Nothing here is mocked.
 * Credentials come from the environment and are never committed.
 */
test.skip(!hasOwnerCredentials, "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD");

test.describe("two-device encrypted chat", () => {
  test("A creates a channel and B decrypts the message; edits, delete and a reaction reflect live", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await signIn(contextA, "A");
    const pageB = await signIn(contextB, "B");

    // Device A creates a fresh channel through the UI from the zero-state
    // workspace; the helper also waits for the channel to be open.
    const channelName = `e2e-${Date.now()}`;
    await createChannel(pageA, channelName);

    // B cannot read the encrypted channel name until it joins the group, so it
    // opens the newest channel (A's, appended last) and then sees the decrypted
    // name once its Welcome is approved.
    const bChannels = pageB.locator("aside button").filter({ hasText: /^#/ });
    await expect(bChannels.last()).toBeVisible({ timeout: 30_000 });
    const channelCount = await bChannels.count();
    await bChannels.nth(channelCount - 1).click();
    await expect(pageB.getByRole("heading", { name: channelName })).toBeVisible({
      timeout: 45_000,
    });

    // A sends an encrypted message.
    const plaintext = `secret-${Date.now()}`;
    await pageA.getByRole("textbox", { name: "Message" }).fill(plaintext);
    await pageA.getByRole("button", { name: "Send" }).click();
    await expect(pageA.getByText(plaintext)).toBeVisible({ timeout: 30_000 });

    // B decrypts and displays the same plaintext, live.
    await expect(pageB.getByText(plaintext)).toBeVisible({ timeout: 45_000 });

    // The server only ever stored ciphertext: the message text is not present
    // in B's serialized Convex payloads.
    const leaked = await pageB.evaluate((needle) => {
      return JSON.stringify(window.localStorage).includes(needle);
    }, plaintext);
    expect(leaked).toBe(false);

    // A edits the message; the update reflects on A and B.
    const edited = `${plaintext}-edited`;
    const messageA = pageA.getByTestId("message-list").getByText(plaintext).first();
    await messageA.hover();
    await pageA.getByRole("button", { name: "Edit message" }).first().click();
    const editor = pageA.locator("textarea").first();
    await editor.fill(edited);
    await pageA.getByRole("button", { name: "Save" }).click();
    await expect(pageA.getByText(edited)).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText(edited)).toBeVisible({ timeout: 45_000 });

    // A reacts; the chip appears on both devices.
    await messageA.hover();
    await pageA.getByRole("button", { name: "React 👍" }).first().click();
    await expect(pageB.getByRole("button", { name: /👍/ }).first()).toBeVisible({
      timeout: 45_000,
    });

    // A deletes the message; both devices show the tombstone.
    await messageA.hover();
    await pageA.getByRole("button", { name: "Delete message" }).first().click();
    await expect(pageA.getByText("This message was deleted.")).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("This message was deleted.")).toBeVisible({ timeout: 45_000 });

    await contextA.close();
    await contextB.close();
  });
});
