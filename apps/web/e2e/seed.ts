/**
 * One-off seeding script for the test server. Signs in as the owner through the
 * real client, gives any generically-named channels friendly names, creates DMs
 * and sends messages so the workspace has valid history.
 *
 *   AULORA_SEED_BASE_URL=http://localhost:5173 bun run e2e/seed.ts
 */
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.AULORA_SEED_BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.AULORA_SEED_OWNER_EMAIL ?? "owner@aulora.test";
const PASSWORD = process.env.AULORA_SEED_OWNER_PASSWORD ?? "Aulora-Test-Password-123";

/** Order matches the channels created on the server; the names to apply. */
const CHANNEL_NAMES = [
  "general",
  "announcements",
  "random",
  "design",
  "engineering",
  "roadmap",
  "ops",
  "watercooler",
  "leadership",
  "owner-notes",
];

const MESSAGES: Record<string, string[]> = {
  general: [
    "Morning everyone ☕ standup in 10.",
    "Reminder: the all-hands moved to Thursday.",
    "Welcome to Aulora! Everything here is encrypted at rest.",
  ],
  design: [
    "Sharing the new mobile comps in a sec — the ember accent is dialed back.",
    "Agreed. The own-message tint reads much calmer now.",
    "I'll wire the role colors into the member list today.",
  ],
  engineering: [
    "Sealed-storage rollout landed in main.",
    "Nice. Deploy freeze starts at 5pm, so let's merge before then.",
    "Read-cursor fix is up for review.",
  ],
  random: ["Anyone else seeing the new sidebar? It's so much cleaner.", "Huge upgrade 👏"],
  announcements: ["**Aulora 0.2 beta** is out: private channels, roles and context menus."],
  watercooler: ["Coffee run at 3? ☕", "In."],
  roadmap: ["Q4 focus: mobile parity, then push relay.", "Let's write that down in ops."],
  ops: ["Backups ran clean overnight.", "@admin the relay credentials are set."],
};

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/`);
  await page.getByLabel("Server address").fill(BASE);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30_000 });
}

/** Right-clicks the nth channel row and picks a context-menu action by label. */
async function channelAction(page: Page, index: number, label: string): Promise<void> {
  const row = page.locator('button[data-testid^="channel-row-"]').nth(index);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: label }).click();
}

async function renameChannel(page: Page, index: number, name: string): Promise<void> {
  await channelAction(page, index, "Rename channel…");
  const dialog = page.getByRole("dialog", { name: "Rename channel" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  await page.waitForTimeout(300);
}

async function sendInChannel(page: Page, name: string, texts: string[]): Promise<void> {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(600);
  const composer = page.getByRole("textbox", { name: "Message" });
  for (const text of texts) {
    await composer.click();
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForTimeout(450);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  await signIn(page);
  await page.waitForTimeout(3000);
  console.log("signed in as owner");

  // Give any generically-named channels friendly names; the server seals the
  // new name at rest.
  const total = await page.locator('button[data-testid^="channel-row-"]').count();
  let unnamed = 0;
  for (let i = 0; i < total; i += 1) {
    const label = await page.locator('button[data-testid^="channel-row-"]').nth(i).innerText();
    if (label.trim().toLowerCase().startsWith("channel")) {
      const name = CHANNEL_NAMES[unnamed] ?? `channel-${unnamed + 1}`;
      try {
        await renameChannel(page, i, name);
        console.log(`renamed channel #${i} -> ${name}`);
      } catch (cause) {
        console.warn(`rename #${i} failed:`, cause instanceof Error ? cause.message : cause);
      }
      unnamed += 1;
    }
  }

  for (const [channel, texts] of Object.entries(MESSAGES)) {
    try {
      await sendInChannel(page, channel, texts);
      console.log(`seeded #${channel} (${texts.length})`);
    } catch (cause) {
      console.warn(`skipped #${channel}:`, cause instanceof Error ? cause.message : cause);
    }
  }

  for (const person of ["Ludmil Popov", "Kathryn Murphy"]) {
    try {
      await page.getByRole("button", { name: "New direct message" }).click();
      await page.getByRole("textbox", { name: "Find people" }).fill(person);
      await page
        .getByRole("button", { name: new RegExp(person) })
        .first()
        .click();
      await page.getByRole("button", { name: /^(Message |Start group)/ }).click();
      await page.waitForTimeout(800);
      const composer = page.getByRole("textbox", { name: "Message" });
      await composer.fill(`Hey ${person.split(" ")[0]}, welcome to Aulora.`);
      await composer.press("Enter");
      await page.waitForTimeout(500);
      console.log(`seeded DM with ${person}`);
    } catch (cause) {
      console.warn(`skipped DM ${person}:`, cause instanceof Error ? cause.message : cause);
    }
  }

  await browser.close();
  console.log("done");
}

void main();
