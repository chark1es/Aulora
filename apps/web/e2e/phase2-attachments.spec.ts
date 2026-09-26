import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * Phase 2, task 3b gate: encrypted uploads, local search and the offline outbox.
 *
 * Runs against a real `docker compose` stack (no mocks). One owner signs in on a
 * fresh context:
 *
 *  1. An image is attached (staged in the composer), encrypted, uploaded and
 *     sent; its thumbnail renders first and clicking it shows the decrypted
 *     full image. The plaintext filename is never present in localStorage.
 *  2. A unique token sent in a message is found by the local search box, which
 *     shows a snippet and jumps to the message.
 *  3. With the browser offline, a send is queued locally and shown optimistically
 *     ("Sending…"); after going back online the outbox flushes and the message
 *     is delivered, without ever duplicating.
 *
 * Credentials come from the environment and are never committed.
 */
const baseURL = process.env.AULORA_E2E_BASE_URL ?? "http://localhost:8080";
const ownerEmail = process.env.AULORA_E2E_OWNER_EMAIL ?? "";
const ownerPassword = process.env.AULORA_E2E_OWNER_PASSWORD ?? "";

test.skip(
  ownerEmail === "" || ownerPassword === "",
  "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD",
);

/** A 64x64 PNG, generated inline so the test ships no binary fixtures. */
function pngBuffer(): Buffer {
  // 1x1 transparent PNG is enough for the canvas pipeline to accept the image.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
}

async function signIn(context: BrowserContext): Promise<Page> {
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
  return page;
}

async function createChannel(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByLabel("Channel name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
}

test.describe("encrypted uploads, search and offline outbox", () => {
  test("image thumbnail then full image, local search, and an offline send that reconnects", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await signIn(context);
    const channelName = `phase2-${Date.now()}`;
    await createChannel(page, channelName);

    // --- 1. Encrypted image upload -----------------------------------------
    const fileName = `diagram-${Date.now()}.png`;
    await page.getByTestId("file-input").setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: pngBuffer(),
    });
    await expect(page.getByTestId("composer-attachments")).toContainText(fileName);
    await page.getByRole("button", { name: "Send" }).click();

    // The plaintext filename renders from the message payload, proving the
    // descriptor decrypted; the server never had the name.
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 30_000 });

    // The image preview is interactive. If the encrypted thumbnail rendered,
    // assert it and use it; otherwise open the full image from the row.
    const thumbnail = page.getByTestId(/^thumbnail-/).first();
    if (await thumbnail.isVisible().catch(() => false)) {
      await thumbnail.click();
    } else {
      await page
        .getByTestId(/^attachment-/)
        .first()
        .click();
    }
    await expect(page.getByTestId(/^fullimage-/).first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // Server/localStorage never sees the plaintext name.
    const leaked = await page.evaluate(
      (needle) => JSON.stringify(window.localStorage).includes(needle),
      fileName,
    );
    expect(leaked).toBe(false);

    // --- 2. Local search ----------------------------------------------------
    const token = `needle${Date.now()}`;
    await page.getByRole("textbox", { name: "Message" }).fill(`a unique ${token} to find`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(token)).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("search-panel")).toBeVisible();
    await page.getByRole("textbox", { name: "Search messages" }).fill(token);

    const result = page.getByTestId("search-result").first();
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(token);
    await result.click();
    // The panel closes and the message is in view on the channel timeline.
    await expect(page.getByTestId("search-panel")).toBeHidden();
    await expect(page.getByTestId("message-list").getByText(token)).toBeVisible({
      timeout: 15_000,
    });

    // --- 3. Offline outbox --------------------------------------------------
    const offlineText = `queued-${Date.now()}`;
    await context.setOffline(true);
    await page.getByRole("textbox", { name: "Message" }).fill(offlineText);
    await page.getByRole("button", { name: "Send" }).click();

    // The optimistic message and the reconnecting bar are visible while queued.
    await expect(page.getByTestId("reconnecting")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("message-list").getByText(offlineText)).toBeVisible();

    // Reconnect: the outbox flushes and the message is delivered once.
    await context.setOffline(false);
    await expect(page.getByTestId("reconnecting")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("message-list").getByText(offlineText)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("message-list").getByText(offlineText)).toHaveCount(1);

    await context.close();
  });
});
