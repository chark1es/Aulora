import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { getTurnSettings, TURN_DEFAULT_TTL_SECONDS } from "../convex/lib/env";
import { buildTurnCredentials, turnCredential, turnUsername } from "../convex/lib/turn";
import { newTest, seedWorkspace } from "./helpers";

const SECRET = "turn-shared-secret-value-0123456789";
const URLS = "turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubTurnEnv(values: Record<string, string> = {}) {
  vi.stubEnv("TURN_URLS", URLS);
  vi.stubEnv("TURN_SECRET", SECRET);
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

describe("getTurnSettings", () => {
  it("is null until both the URLs and a usable secret are present", () => {
    expect(getTurnSettings({})).toBeNull();
    expect(getTurnSettings({ TURN_URLS: URLS })).toBeNull();
    expect(getTurnSettings({ TURN_URLS: URLS, TURN_SECRET: "short" })).toBeNull();
    expect(getTurnSettings({ TURN_SECRET: SECRET })).toBeNull();
  });

  it("rejects anything that is not a turn:/turns: URL", () => {
    expect(
      getTurnSettings({ TURN_URLS: "stun:relay.example.com:3478", TURN_SECRET: SECRET }),
    ).toBeNull();
    expect(getTurnSettings({ TURN_URLS: "relay.example.com", TURN_SECRET: SECRET })).toBeNull();
    expect(
      getTurnSettings({ TURN_URLS: "turn:relay.example.com:3478,https://x", TURN_SECRET: SECRET }),
    ).toBeNull();
  });

  it("splits comma- and whitespace-separated URLs and keeps order", () => {
    const settings = getTurnSettings({
      TURN_URLS: "turns:relay.example.com:5349  turn:relay.example.com:3478",
      TURN_SECRET: SECRET,
    });
    expect(settings?.urls).toEqual(["turns:relay.example.com:5349", "turn:relay.example.com:3478"]);
  });

  it("defaults an unparsable TTL but honours a valid one", () => {
    expect(
      getTurnSettings({ TURN_URLS: URLS, TURN_SECRET: SECRET, TURN_TTL_SECONDS: "soon" })
        ?.ttlSeconds,
    ).toBe(TURN_DEFAULT_TTL_SECONDS);
    expect(
      getTurnSettings({ TURN_URLS: URLS, TURN_SECRET: SECRET, TURN_TTL_SECONDS: "10" })?.ttlSeconds,
    ).toBe(TURN_DEFAULT_TTL_SECONDS);
    expect(
      getTurnSettings({ TURN_URLS: URLS, TURN_SECRET: SECRET, TURN_TTL_SECONDS: "600" })
        ?.ttlSeconds,
    ).toBe(600);
  });
});

describe("turn credentials", () => {
  it("matches the RFC 5766/Draft-uberti HMAC-SHA1 credential", async () => {
    const username = turnUsername(1_800_000_000, "user-1");
    expect(username).toBe("1800000000:user-1");
    const expected = createHmac("sha1", SECRET).update(username).digest("base64");
    expect(await turnCredential(SECRET, username)).toBe(expected);
  });

  it("encodes bytes as padded base64 for all remainder lengths", async () => {
    // HMAC-SHA1 is always 20 bytes, so exercise the helper through three
    // secrets whose digests are stable and independent of padding assumptions.
    for (const secret of ["a".repeat(16), "b".repeat(17), "c".repeat(18)]) {
      const username = turnUsername(1_800_000_000, "u");
      expect(await turnCredential(secret, username)).toBe(
        createHmac("sha1", secret).update(username).digest("base64"),
      );
    }
  });

  it("mints a username that expires exactly one TTL after now", async () => {
    const credentials = await buildTurnCredentials({
      settings: { urls: ["turn:relay.example.com:3478"], secret: SECRET, ttlSeconds: 600 },
      userId: "user-1",
      now: 1_700_000_000,
    });
    expect(credentials.expiresAt).toBe(1_700_000_600);
    expect(credentials.username).toBe("1700000600:user-1");
    expect(credentials.credential).toBe(
      createHmac("sha1", SECRET).update("1700000600:user-1").digest("base64"),
    );
    expect(credentials.ttlSeconds).toBe(600);
  });
});

describe("turn.credentials", () => {
  function seed() {
    const t = newTest();
    return { t };
  }

  it("returns null when the deployment has no TURN server", async () => {
    const { t } = seed();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const result = await t.withIdentity({ subject: "user-1" }).mutation(api.turn.credentials, {});
    expect(result).toBeNull();
  });

  it("mints a member a credential for this deployment's relay", async () => {
    stubTurnEnv({ TURN_TTL_SECONDS: "900" });
    const { t } = seed();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const result = await t.withIdentity({ subject: "user-1" }).mutation(api.turn.credentials, {});
    expect(result).not.toBeNull();
    expect(result?.urls).toEqual([
      "turn:relay.example.com:3478?transport=udp",
      "turn:relay.example.com:3478?transport=tcp",
    ]);
    expect(result?.ttlSeconds).toBe(900);
    expect(result?.username.endsWith(":user-1")).toBe(true);
    expect(result?.credential).toBe(
      createHmac("sha1", SECRET)
        .update(result?.username ?? "")
        .digest("base64"),
    );
  });

  it("refuses an unauthenticated caller", async () => {
    stubTurnEnv();
    const { t } = seed();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await expect(t.mutation(api.turn.credentials, {})).rejects.toThrow(/Not authenticated/);
  });

  it("refuses an account that is not a workspace member", async () => {
    stubTurnEnv();
    const { t } = seed();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await expect(
      t.withIdentity({ subject: "outsider-1" }).mutation(api.turn.credentials, {}),
    ).rejects.toThrow(/Not a member/);
  });
});
