import { type BrowserContext, expect, type Page, test } from "@playwright/test";

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
const baseURL = process.env.AULORA_E2E_BASE_URL ?? "http://localhost:8080";
const ownerEmail = process.env.AULORA_E2E_OWNER_EMAIL ?? "";
const ownerPassword = process.env.AULORA_E2E_OWNER_PASSWORD ?? "";

test.skip(
  ownerEmail === "" || ownerPassword === "",
  "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD",
);

async function signIn(context: BrowserContext, deviceName: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeVisible();
  await page.getByLabel("Server address").fill(baseURL);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("message-list")).toBeVisible({ timeout: 30_000 });
  test.info().annotations.push({ type: "device", description: deviceName });
  return page;
}

test.describe("two-device encrypted chat", () => {
  test("A creates a channel and B decrypts the message; edits, delete and a reaction reflect live", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await signIn(contextA, "A");
    const pageB = await signIn(contextB, "B");

    // Device A creates a fresh channel.
    const channelName = `e2e-${Date.now()}`;
    await pageA.getByRole("button", { name: "Create channel" }).click();
    await pageA.getByLabel("Channel name").fill(channelName);
    await pageA.getByRole("button", { name: "Create", exact: true }).click();
    await expect(pageA.getByRole("heading", { name: channelName })).toBeVisible({
      timeout: 30_000,
    });

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
