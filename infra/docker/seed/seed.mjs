/**
 * Seeds a running Aulora instance with test data: several email/password
 * accounts, categories, text + announcement channels (including two private
 * ones), direct and group conversations, message history, one thread and a few
 * reactions.
 *
 * It talks to the real stack through the public HTTP surface only:
 *   - Better Auth sign-up/sign-in at `${BASE_URL}/api/auth/*` (same-origin,
 *     proxied by the web container), and
 *   - the Convex HTTP API at `${CONVEX_URL}/api/{query,mutation}` with the JWT
 *     from `/api/auth/convex/token` as a Bearer token.
 *
 * It is idempotent: accounts are reused when they already exist and channels
 * that are already present are skipped, so it is safe to re-run.
 *
 *   BASE_URL=http://localhost:8080 CONVEX_URL=http://localhost:3210 \
 *     bun infra/docker/seed/seed.mjs
 */

const BASE_URL = process.env.BASE_URL ?? process.env.AULORA_SEED_BASE_URL ?? "http://localhost:8080";
const CONVEX_URL =
  process.env.CONVEX_URL ?? process.env.AULORA_SEED_CONVEX_URL ?? "http://localhost:3210";

const OWNER = {
  email: process.env.OWNER_EMAIL ?? "owner@aulora.test",
  password: process.env.OWNER_PASSWORD ?? "Aulora-Test-Password-123",
  name: process.env.OWNER_NAME ?? "Aulora Owner",
};

// Shared credential for every seeded account, so sign-in works in the UI.
const PASSWORD = process.env.SEED_PASSWORD ?? "Aulora-Test-Password-123";

const USERS = [
  { email: "maya@aulora.test", name: "Maya Chen" },
  { email: "diego@aulora.test", name: "Diego Ramos" },
  { email: "priya@aulora.test", name: "Priya Nair" },
  { email: "jonas@aulora.test", name: "Jonas Weber" },
  { email: "amara@aulora.test", name: "Amara Okafor" },
  { email: "kenji@aulora.test", name: "Kenji Watanabe" },
];

const log = (...args) => console.log("[seed]", ...args);

// --- HTTP helpers -----------------------------------------------------------

function readCookies(response) {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const jar = new Map();
  for (const cookie of raw) {
    for (const part of String(cookie).split(/,(?=[^;]+=)/)) {
      const pair = part.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) {
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function authRequest(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const cookies = readCookies(response);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, cookies, json };
}

async function getConvexToken(cookies) {
  const response = await fetch(`${BASE_URL}/api/auth/convex/token`, {
    headers: { cookie: cookies },
  });
  if (!response.ok) {
    throw new Error(`convex/token failed: HTTP ${response.status}`);
  }
  const { token } = await response.json();
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("convex/token returned no token");
  }
  return token;
}

async function convex(kind, path, args, token) {
  const response = await fetch(`${CONVEX_URL}/api/${kind}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path}: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${path}: HTTP ${response.status}: ${parsed.message ?? parsed.errorMessage ?? text.slice(0, 200)}`,
    );
  }
  if (parsed.status === "error") {
    throw new Error(`${path}: ${parsed.errorMessage ?? text.slice(0, 200)}`);
  }
  return parsed.value;
}

const query = (path, args, token) => convex("query", path, args, token);
const mutate = (path, args, token) => convex("mutation", path, args, token);

// --- Accounts ---------------------------------------------------------------

async function ensureAccount(user) {
  const signUp = await authRequest("/api/auth/sign-up/email", {
    email: user.email,
    password: user.password ?? PASSWORD,
    name: user.name,
  });
  if (signUp.response.ok) {
    return { ...user, id: signUp.json.user.id, cookies: signUp.cookies };
  }
  const signIn = await authRequest("/api/auth/sign-in/email", {
    email: user.email,
    password: user.password ?? PASSWORD,
  });
  if (!signIn.response.ok) {
    throw new Error(`could not sign in ${user.email}: HTTP ${signIn.response.status}`);
  }
  return { ...user, id: signIn.json.user.id, cookies: signIn.cookies };
}

async function main() {
  log(`stack: web=${BASE_URL} convex=${CONVEX_URL}`);

  const owner = await ensureAccount(OWNER);
  owner.token = await getConvexToken(owner.cookies);
  const ownerToken = owner.token;
  log(`owner ready: ${owner.email} (${owner.id})`);

  const people = [];
  for (const user of USERS) {
    const account = await ensureAccount(user);
    account.token = await getConvexToken(account.cookies);
    people.push(account);
    log(`account ready: ${account.name} <${account.email}>`);
  }

  const actor = (name) => {
    const match = people.find((person) => person.name === name);
    if (match === undefined) {
      throw new Error(`unknown actor ${name}`);
    }
    return match;
  };

  // Skip channels that already exist (idempotent re-runs).
  const existing = await query(
    "channels:list",
    { paginationOpts: { numItems: 200, cursor: null } },
    ownerToken,
  );
  const existingNames = new Set((existing.page ?? []).map((channel) => channel.name));

  const existingCategories = await query("categories:list", {}, ownerToken);
  const existingCategoryNames = new Set((existingCategories ?? []).map((item) => item.name));

  async function createCategory(name, position) {
    if (existingCategoryNames.has(name)) {
      log(`category ${name} already exists, skipping`);
      return null;
    }
    const id = await mutate("categories:create", { name, position }, ownerToken);
    log(`created category ${name}`);
    return id;
  }

  async function createChannel({ name, kind = "text", topic, categoryId, private: isPrivate }) {
    if (existingNames.has(name)) {
      log(`channel #${name} already exists, skipping`);
      return null;
    }
    const args = { kind, name };
    if (topic !== undefined) args.topic = topic;
    if (categoryId !== undefined) args.categoryId = categoryId;
    if (isPrivate === true) args.private = true;
    const id = await mutate("channels:create", args, ownerToken);
    log(`created ${isPrivate === true ? "private " : ""}${kind} #${name}`);
    return id;
  }

  async function send(author, channelId, body, extra = {}) {
    const messageId = await mutate(
      "messages:send",
      { channelId, body, ...extra },
      author.token,
    );
    return messageId;
  }

  // --- Categories + channels ------------------------------------------------

  const textCategory = await createCategory("Text Channels", 0);
  const productCategory = await createCategory("Product", 1);
  const opsCategory = await createCategory("Operations", 2);

  const channelIds = {};
  channelIds.general = await createChannel({
    name: "general",
    topic: "Company-wide chatter and announcements in one place.",
    categoryId: textCategory ?? undefined,
  });
  channelIds.announcements = await createChannel({
    name: "announcements",
    kind: "announcement",
    topic: "Read-only updates from the team.",
    categoryId: textCategory ?? undefined,
  });
  channelIds.random = await createChannel({
    name: "random",
    topic: "Off-topic. Memes welcome.",
    categoryId: textCategory ?? undefined,
  });
  channelIds.design = await createChannel({
    name: "design",
    topic: "Comps, critique and the shared design system.",
    categoryId: productCategory ?? undefined,
  });
  channelIds.engineering = await createChannel({
    name: "engineering",
    topic: "Builds, deploys and code review.",
    categoryId: productCategory ?? undefined,
  });
  channelIds.roadmap = await createChannel({
    name: "roadmap",
    topic: "What we are shipping next.",
    categoryId: productCategory ?? undefined,
  });
  channelIds.ops = await createChannel({
    name: "ops",
    topic: "Infra, on-call and incidents.",
    categoryId: opsCategory ?? undefined,
  });
  channelIds.watercooler = await createChannel({
    name: "watercooler",
    topic: "Coffee runs and watercooler talk.",
    categoryId: opsCategory ?? undefined,
  });

  // Private channels; only explicit members can see them.
  channelIds.leadership = await createChannel({
    name: "leadership",
    topic: "Private: planning and people topics.",
    private: true,
  });
  channelIds.owner_notes = await createChannel({ name: "owner-notes", private: true });

  async function addPrivateMember(channelId, userId) {
    if (channelId === null || channelId === undefined) return;
    try {
      await mutate("channels:addMember", { channelId, userId }, ownerToken);
    } catch (error) {
      log(`addMember skipped: ${error.message}`);
    }
  }
  await addPrivateMember(channelIds.leadership, actor("Priya Nair").id);
  await addPrivateMember(channelIds.leadership, actor("Kenji Watanabe").id);

  // --- Message history ------------------------------------------------------

  const canSeedMessages = channelIds.general !== null && channelIds.general !== undefined;
  const sent = {};
  if (canSeedMessages) {
    sent.general1 = await send(
      actor("Maya Chen"),
      channelIds.general,
      "Morning everyone :coffee: standup in 10.",
    );
    await send(actor("Diego Ramos"), channelIds.general, "On my way, grabbing a coffee first.");
    await send(
      actor("Priya Nair"),
      channelIds.general,
      "Reminder: the all-hands moved to Thursday at 15:00.",
    );
    await send(
      actor("Amara Okafor"),
      channelIds.general,
      "Welcome to Aulora! Everything here is encrypted at rest.",
      { mentionUserIds: [owner.id] },
    );

    await send(
      actor("Amara Okafor"),
      channelIds.announcements,
      "**Aulora 0.2 beta** is out: private channels, roles and context menus.",
    );
    await send(
      actor("Amara Okafor"),
      channelIds.announcements,
      "Deploy freeze starts Friday 17:00 and lifts Monday 09:00.",
    );

    sent.random1 = await send(
      actor("Jonas Weber"),
      channelIds.random,
      "Anyone else seeing the new sidebar? It is so much cleaner.",
    );
    await send(actor("Maya Chen"), channelIds.random, "Huge upgrade.");

    await send(
      actor("Maya Chen"),
      channelIds.design,
      "Sharing the new mobile comps in a sec, the ember accent is dialed back.",
    );
    sent.design2 = await send(
      actor("Kenji Watanabe"),
      channelIds.design,
      "Agreed. The own-message tint reads much calmer now.",
    );
    await send(
      actor("Maya Chen"),
      channelIds.design,
      "I will wire the role colors into the member list today.",
    );

    sent.engRoot = await send(
      actor("Diego Ramos"),
      channelIds.engineering,
      "Sealed-storage rollout landed in main.",
    );
    sent.eng2 = await send(
      actor("Priya Nair"),
      channelIds.engineering,
      "Nice. Deploy freeze starts at 5pm, so let's merge before then.",
      { mentionUserIds: [actor("Diego Ramos").id] },
    );
    await send(actor("Jonas Weber"), channelIds.engineering, "Read-cursor fix is up for review.");

    sent.threadReply = await send(
      actor("Priya Nair"),
      channelIds.engineering,
      "Merged. I will watch the error budget for the next hour.",
      { threadRootId: sent.engRoot },
    );
    await send(
      actor("Diego Ramos"),
      channelIds.engineering,
      "Thanks! Rotating the old key tomorrow.",
      { threadRootId: sent.engRoot },
    );

    await send(actor("Kenji Watanabe"), channelIds.roadmap, "Q4 focus: mobile parity, then push relay.");
    await send(actor("Priya Nair"), channelIds.roadmap, "Let's write that down in ops.");

    await send(actor("Jonas Weber"), channelIds.ops, "Backups ran clean overnight.");
    sent.ops2 = await send(
      actor("Jonas Weber"),
      channelIds.ops,
      "The relay credentials are set and verified.",
      { mentionUserIds: [owner.id] },
    );

    await send(actor("Amara Okafor"), channelIds.watercooler, "Coffee run at 3?");
    await send(actor("Maya Chen"), channelIds.watercooler, "In.");

    await send(
      owner,
      channelIds.leadership,
      "Private channel check-in: how is the hiring loop feeling?",
    );
    await send(actor("Priya Nair"), channelIds.leadership, "Strong. Two onsites this week.");
    await send(owner, channelIds.owner_notes, "Remember to rotate AULORA_ENCRYPTION_KEY after the demo.");
  } else {
    log("channels already existed; skipping message history");
  }

  // --- Reactions ------------------------------------------------------------

  async function react(messageId, userId, emoji) {
    if (messageId === null || messageId === undefined) return;
    const person = people.find((candidate) => candidate.id === userId) ?? owner;
    try {
      await mutate("reactions:toggle", { messageId, emoji }, person.token);
    } catch (error) {
      log(`reaction skipped: ${error.message}`);
    }
  }
  await react(sent.general1, actor("Diego Ramos").id, "👍");
  await react(sent.general1, actor("Priya Nair").id, "👍");
  await react(sent.general1, actor("Amara Okafor").id, "🎉");
  await react(sent.engRoot, actor("Priya Nair").id, "🚀");
  await react(sent.threadReply, actor("Diego Ramos").id, "🙏");

  // --- Direct + group conversations -----------------------------------------

  async function createDm(initiator, other) {
    const result = await mutate("channels:createDm", { otherUserId: other.id }, initiator.token);
    log(`${result.created ? "created" : "reused"} DM ${initiator.name} <-> ${other.name}`);
    return result.channelId;
  }

  const dmMaya = await createDm(owner, actor("Maya Chen"));
  await send(owner, dmMaya, "Hey Maya, welcome to Aulora.");
  await send(actor("Maya Chen"), dmMaya, "Thanks! The dark theme looks great.");
  await send(owner, dmMaya, "Ping me when the comps are ready.");

  const dmDiego = await createDm(actor("Priya Nair"), actor("Diego Ramos"));
  await send(actor("Priya Nair"), dmDiego, "Do you have five minutes to pair on the read-cursor bug?");
  await send(actor("Diego Ramos"), dmDiego, "Sure, hopping on a call now.");

  const groupDm = await mutate(
    "channels:createGroupDm",
    { memberIds: [actor("Priya Nair").id, actor("Kenji Watanabe").id] },
    ownerToken,
  );
  log(`created group DM (leadership sync)`);
  await send(owner, groupDm.channelId, "Leadership sync agenda is in #leadership.");
  await send(actor("Kenji Watanabe"), groupDm.channelId, "Added the roadmap notes.");
  await send(actor("Priya Nair"), groupDm.channelId, "I will post the hiring update after standup.");

  log("done");
  log("");
  log("Sign in at", BASE_URL, "with any of:");
  for (const account of [owner, ...people]) {
    log(`  ${account.email}  /  ${PASSWORD}`);
  }
}

main().catch((error) => {
  console.error("[seed] FAILED:", error.message);
  process.exit(1);
});
