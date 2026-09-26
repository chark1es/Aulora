import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * Shared first-run helpers for the Phase 2 e2e suite.
 *
 * Every spec must be self-sufficient from a zero-channel workspace: sign-in
 * only asserts the signed-in shell (the workspace/server rail), and specs that
 * need the chat surface create and open a channel through the real UI first.
 *
 * Credentials come from the environment and are never committed.
 */
export const baseURL = process.env.AULORA_E2E_BASE_URL ?? "http://localhost:8080";
export const ownerEmail = process.env.AULORA_E2E_OWNER_EMAIL ?? "";
export const ownerPassword = process.env.AULORA_E2E_OWNER_PASSWORD ?? "";

/** Whether the owner credentials needed to run the suite are configured. */
export const hasOwnerCredentials = ownerEmail !== "" && ownerPassword !== "";

/**
 * Runs the connect -> well-known -> sign-in flow on an existing page and
 * asserts the signed-in shell: the workspace/server rail and sign-out control.
 * It deliberately does not assert `message-list`, which only exists once a
 * channel is open.
 */
export async function connectAndSignIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeVisible();
  await page.getByLabel("Server address").fill(baseURL);
  await page.getByRole("button", { name: "Connect" }).click();

  // Preview is built from the real well-known document.
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expectSignedInShell(page);
}

/** Asserts the signed-in workspace/server rail is on screen. */
export async function expectSignedInShell(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Create channel" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Opens a fresh isolated context, signs in and annotates the device name. */
export async function signIn(context: BrowserContext, deviceName?: string): Promise<Page> {
  const page = await context.newPage();
  await connectAndSignIn(page);
  if (deviceName !== undefined) {
    test.info().annotations.push({ type: "device", description: deviceName });
  }
  return page;
}

/**
 * Creates a channel through the real UI and opens it. The creator is selected
 * onto the new channel automatically, so this waits for the heading and the
 * message list to be live before returning.
 */
export async function createChannel(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByLabel("Channel name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("message-list")).toBeVisible({ timeout: 30_000 });
}
