/**
 * Provisions two easy-to-remember test accounts against a running Aulora stack
 * and, when the owner credentials are available, a voice channel plus a DM
 * between them so calling can be tested immediately.
 *
 *   BASE_URL=http://localhost:8080 CONVEX_URL=http://localhost:3210 \
 *     bun infra/docker/seed/test-accounts.mjs
 *
 * Idempotent: accounts, the voice channel and the DM are reused when present.
 *
 *   p1@aulora.test / p1
 *   p2@aulora.test / p2
 */

const env = new Map(Object.entries(process.env));
const BASE_URL = env.get("BASE_URL") ?? env.get("AULORA_SEED_BASE_URL") ?? "http://localhost:8080";
const CONVEX_URL =
  env.get("CONVEX_URL") ?? env.get("AULORA_SEED_CONVEX_URL") ?? "http://localhost:3210";

const ACCOUNTS = [
  { email: "p1@aulora.test", password: "p1", name: "Player One" },
  { email: "p2@aulora.test", password: "p2", name: "Player Two" },
];

const OWNER = {
  email: env.get("OWNER_EMAIL") ?? "owner@aulora.test",
  password: env.get("OWNER_PASSWORD") ?? "Aulora-Test-Password-123",
};

const log = (...args) => console.log("[test-accounts]", ...args);

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

const AUTH_PATHS = new Set(["/api/auth/sign-up/email", "/api/auth/sign-in/email"]);
const CONVEX_KINDS = new Set(["query", "mutation"]);

async function authRequest(path, body) {
  if (AUTH_PATHS.has(path)) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { response, cookies: readCookies(response), json };
  }
  throw new Error(`unsupported auth path: ${path}`);
}

async function getConvexToken(cookies) {
  const response = await fetch(`${BASE_URL}/api/auth/convex/token`, {
    headers: { cookie: cookies },
  });
  if (!response.ok) {
    throw new Error(`convex/token failed: HTTP ${response.status}`);
  }
  const { token } = await response.json();
  return token;
}

async function convex(kind, path, args, token) {
  if (CONVEX_KINDS.has(kind)) {
    const response = await fetch(`${CONVEX_URL}/api/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, args, format: "json" }),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${path}: HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    if (!response.ok || parsed.status === "error") {
      throw new Error(
        `${path}: HTTP ${response.status}: ${parsed.message ?? parsed.errorMessage ?? text.slice(0, 200)}`,
      );
    }
    return parsed.value;
  }
  throw new Error(`unsupported Convex API kind: ${kind}`);
}

const query = (path, args, token) => convex("query", path, args, token);
const mutate = (path, args, token) => convex("mutation", path, args, token);

async function ensureAccount(user) {
  const signUp = await authRequest("/api/auth/sign-up/email", user);
  if (signUp.response.ok) {
    return { ...user, id: signUp.json.user.id, cookies: signUp.cookies, created: true };
  }
  const signIn = await authRequest("/api/auth/sign-in/email", {
    email: user.email,
    password: user.password,
  });
  if (!signIn.response.ok) {
    throw new Error(
      `could not create or sign in ${user.email}: sign-up ${signUp.json?.code ?? signUp.response.status}, ` +
        `sign-in HTTP ${signIn.response.status}`,
    );
  }
  return { ...user, id: signIn.json.user.id, cookies: signIn.cookies, created: false };
}

async function tryOwner() {
  try {
    const signIn = await authRequest("/api/auth/sign-in/email", {
      email: OWNER.email,
      password: OWNER.password,
    });
    if (!signIn.response.ok) {
      return null;
    }
    const account = { ...OWNER, id: signIn.json.user.id, cookies: signIn.cookies };
    account.token = await getConvexToken(account.cookies);
    return account;
  } catch {
    return null;
  }
}

async function main() {
  log(`stack: web=${BASE_URL} convex=${CONVEX_URL}`);

  const people = [];
  for (const account of ACCOUNTS) {
    const ready = await ensureAccount(account);
    ready.token = await getConvexToken(ready.cookies);
    people.push(ready);
    log(`${ready.created ? "created" : "reused"} ${ready.email} / ${ready.password} (${ready.id})`);
  }

  const [p1, p2] = people;

  // Ensure a DM exists between the two so a direct call can be started.
  try {
    const dm = await mutate("channels:createDm", { otherUserId: p2.id }, p1.token);
    log(`${dm.created ? "created" : "reused"} DM p1 <-> p2 (${dm.channelId})`);
  } catch (error) {
    log(`DM skipped: ${error.message}`);
  }

  // Ensure a public voice channel exists for channel calling (owner only).
  const owner = await tryOwner();
  if (owner === null) {
    log("owner sign-in unavailable; skipped voice channel provisioning");
  } else {
    try {
      const existing = await query(
        "channels:list",
        { paginationOpts: { numItems: 200, cursor: null } },
        owner.token,
      );
      const hasVoice = (existing.page ?? []).some(
        (channel) => channel.kind === "voice" && channel.name === "lounge",
      );
      if (hasVoice) {
        log("voice channel #lounge already exists");
      } else {
        const channelId = await mutate(
          "channels:create",
          { kind: "voice", name: "lounge", topic: "Drop in and talk." },
          owner.token,
        );
        log(`created voice channel #lounge (${channelId})`);
      }
    } catch (error) {
      log(`voice channel skipped: ${error.message}`);
    }
  }

  log("done. Sign in at", BASE_URL, "with:");
  for (const account of people) {
    log(`  ${account.email}  /  ${account.password}`);
  }
}

main().catch((error) => {
  console.error("[test-accounts] FAILED:", error.message);
  process.exit(1);
});
