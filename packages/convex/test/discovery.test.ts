import { containsSecretField, fetchWellKnown } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://aulora.chark1es.dev");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://aulora.chark1es.dev");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspace discovery", () => {
  it("connects from the main URL using the backend HTTP route", async () => {
    const t = newTest();
    await seedWorkspace(t);

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://aulora.chark1es.dev");
      return await t.fetch(`${url.pathname}${url.search}`, init);
    };
    const document = await fetchWellKnown("aulora.chark1es.dev", { fetchImpl });

    expect(document).toMatchObject({
      name: "Acme",
      apiVersion: 1,
      convexUrl: "https://aulora.chark1es.dev",
      siteUrl: "https://aulora.chark1es.dev",
    });
    expect(containsSecretField(document)).toBe(false);
  });

  it("only publishes discovery fields, excluding provider secrets and TURN credentials", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "provider-secret");
    vi.stubEnv(
      "AULORA_ICE_SERVERS",
      JSON.stringify([{ urls: "turn:relay.example.com", credential: "turn-secret" }]),
    );
    const t = newTest();
    await seedWorkspace(t);
    const document = await fetchWellKnown("aulora.chark1es.dev", {
      fetchImpl: async () => await t.fetch("/.well-known/aulora.json"),
    });

    expect(document.auth.providers).toContainEqual({
      id: "github",
      type: "oauth",
      displayName: "GitHub",
    });
    expect(JSON.stringify(document)).not.toContain("provider-secret");
    expect(JSON.stringify(document)).not.toContain("turn-secret");
  });

  it("allows browser discovery across origins and does not cache workspace settings", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const response = await t.fetch("/.well-known/aulora.json", {
      headers: { Origin: "https://client.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    await t.withIdentity({ subject: "owner-1" }).mutation(api.server.updateBranding, {
      name: "Renamed workspace",
    });
    const updated = await t.fetch("/.well-known/aulora.json");
    expect(await updated.json()).toMatchObject({ name: "Renamed workspace" });
  });
});
