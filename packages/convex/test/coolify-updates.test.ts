import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { coolifyConfiguration, createCoolifyUpdater } from "../convex/lib/coolifyUpdates";
import { AULORA_VERSION } from "../convex/lib/env";
import { newTest, seedWorkspace } from "./helpers";

const keys = [
  "AULORA_UPDATE_PROVIDER",
  "AULORA_COOLIFY_URL",
  "AULORA_COOLIFY_API_TOKEN",
  "AULORA_COOLIFY_APPLICATION_UUID",
  "AULORA_UPDATE_MANIFEST_URL",
];
afterEach(() => {
  for (const key of keys) delete process.env[key];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const config = {
  apiUrl: "https://coolify.example.com/api/v1",
  token: "private-token",
  applicationUuid: "app-1",
};
const sha = "a".repeat(40);
function configure() {
  process.env.AULORA_COOLIFY_URL = "https://coolify.example.com";
  process.env.AULORA_COOLIFY_API_TOKEN = config.token;
  process.env.AULORA_COOLIFY_APPLICATION_UUID = config.applicationUuid;
}
function network(...bodies: unknown[]) {
  const mock = vi.fn();
  for (const body of bodies) mock.mockResolvedValueOnce(Response.json(body));
  vi.stubGlobal("fetch", mock);
  return mock;
}
const operation = { targetVersion: "9.0.0", gitTag: "v9.0.0", githubRepo: "chark1es/Aulora" };

describe("Coolify update adapter", () => {
  it("recognizes unconfigured Coolify deployments and validates URL and application identity", () => {
    expect(coolifyConfiguration().provider).toBe("host");
    process.env.AULORA_UPDATE_PROVIDER = "coolify";
    expect(coolifyConfiguration()).toMatchObject({
      provider: "coolify",
      config: null,
      error: expect.stringContaining("Set AULORA"),
    });
    configure();
    expect(coolifyConfiguration()).toMatchObject({ config });
    process.env.AULORA_COOLIFY_URL = "https://user:password@coolify.example.com";
    expect(coolifyConfiguration().config).toBeNull();
    process.env.AULORA_COOLIFY_URL = "http://192.168.1.2:8000/api/v1/";
    expect(coolifyConfiguration().config?.apiUrl).toBe("http://192.168.1.2:8000/api/v1");
    process.env.AULORA_COOLIFY_APPLICATION_UUID = "app-1,another-app";
    expect(coolifyConfiguration().config).toBeNull();
  });

  it("pins the published commit before deploying exactly one application", async () => {
    const mock = network(
      { build_pack: "dockercompose", git_repository: "https://github.com/chark1es/Aulora.git" },
      { sha },
      { uuid: "app-1" },
      { deployments: [{ resource_uuid: "app-1", deployment_uuid: "deployment-1" }] },
    );
    expect(await createCoolifyUpdater(config).deploy(operation.githubRepo, operation.gitTag)).toBe(
      "deployment-1",
    );
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      `${config.apiUrl}/applications/app-1`,
      "https://api.github.com/repos/chark1es/Aulora/commits/v9.0.0",
      `${config.apiUrl}/applications/app-1`,
      `${config.apiUrl}/deploy?uuid=app-1`,
    ]);
    expect(mock.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ git_commit_sha: sha }),
      redirect: "error",
    });
    expect(mock.mock.calls[1]?.[1].headers).not.toHaveProperty("Authorization");
  });

  it("refuses a different repository before changing or deploying anything", async () => {
    const mock = network({
      build_pack: "dockercompose",
      git_repository: "https://github.com/someone/other.git",
    });
    await expect(
      createCoolifyUpdater(config).deploy(operation.githubRepo, operation.gitTag),
    ).rejects.toThrow("update feed's GitHub repository");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not leak response bodies or credentials on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(config.token, { status: 401 })));
    await expect(createCoolifyUpdater(config).status("deployment-1")).rejects.toThrow("HTTP 401");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(config.token)));
    await expect(createCoolifyUpdater(config).status("deployment-1")).rejects.toThrow(
      "could not be reached",
    );
  });

  it("tracks queued, running, completed, failed, and cancelled deployments", async () => {
    network(
      ...["queued", "in_progress", "finished", "failed", "cancelled-by-user"].map((status) => ({
        status,
      })),
    );
    const adapter = createCoolifyUpdater(config);
    for (const expected of ["installing", "installing", "installed", "failed", "failed"])
      expect(await adapter.status("deployment-1")).toBe(expected);
  });
});

describe("Coolify instance updates", () => {
  it("runs the scheduled deployment and completion poll through to an installed release", async () => {
    vi.useFakeTimers();
    configure();
    const t = newTest();
    await seedWorkspace(t);
    network(
      { build_pack: "dockercompose", git_repository: "https://github.com/chark1es/Aulora.git" },
      { sha },
      {},
      { deployments: [{ resource_uuid: "app-1", deployment_uuid: "deployment-1" }] },
      { status: "finished" },
    );
    const id = await t.mutation(internal.updates.beginCoolifyInstall, {
      ...operation,
      targetVersion: AULORA_VERSION,
    });
    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });
    expect(await t.query(internal.updates.coolifyOperation, { id })).toMatchObject({
      phase: "installed",
      deploymentUuid: "deployment-1",
      error: null,
    });
  });
  it("requires owner authority and never exposes configuration secrets", async () => {
    configure();
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "member" }] });
    const member = t.withIdentity({ subject: "member" });
    await expect(member.query(api.updates.capabilities, {})).rejects.toThrow("Instance admin");
    await expect(member.action(api.updates.installCoolify, {})).rejects.toThrow("Instance admin");
    const owner = t.withIdentity({ subject: "owner-1" });
    expect(await owner.query(api.updates.capabilities, {})).toEqual({
      provider: "coolify",
      configured: true,
      error: null,
      status: null,
    });
    await expect(owner.mutation(api.updates.request, { command: "download" })).rejects.toThrow(
      "Use Install update",
    );
  });

  it("rejects incomplete configuration and installs only a newer published release", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const owner = t.withIdentity({ subject: "owner-1" });
    process.env.AULORA_UPDATE_PROVIDER = "coolify";
    await expect(owner.action(api.updates.installCoolify, {})).rejects.toThrow("Set AULORA");
    configure();
    network({ version: AULORA_VERSION });
    await expect(owner.action(api.updates.installCoolify, {})).rejects.toThrow(
      "No update needs installing",
    );
  });

  it("queues the release on the server and refuses concurrent installation", async () => {
    vi.useFakeTimers();
    configure();
    const t = newTest();
    await seedWorkspace(t);
    const owner = t.withIdentity({ subject: "owner-1" });
    network({ version: "9.0.0" }, { version: "9.0.0" });
    await owner.action(api.updates.installCoolify, {});
    expect(await owner.query(api.updates.capabilities, {})).toMatchObject({
      status: { phase: "installing", targetVersion: "9.0.0" },
    });
    await expect(owner.action(api.updates.installCoolify, {})).rejects.toThrow(
      "already in progress",
    );
  });

  it("polls durably, keeps the lock on connection failure, and verifies the running version", async () => {
    vi.useFakeTimers();
    configure();
    const t = newTest();
    await seedWorkspace(t);
    const id = await t.mutation(internal.updates.beginCoolifyInstall, operation);
    await t.mutation(internal.updates.reportCoolify, {
      id,
      phase: "installing",
      error: null,
      deploymentUuid: "deployment-1",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await t.action(internal.updates.pollCoolify, { id });
    expect(await t.query(internal.updates.coolifyOperation, { id })).toMatchObject({
      phase: "installing",
      error: expect.stringContaining("could not be reached"),
    });
    network({ status: "finished" });
    await t.action(internal.updates.pollCoolify, { id });
    expect(await t.query(internal.updates.coolifyOperation, { id })).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("different version"),
    });
    const nextId = await t.mutation(internal.updates.beginCoolifyInstall, {
      ...operation,
      targetVersion: AULORA_VERSION,
    });
    await t.mutation(internal.updates.reportCoolify, {
      id: nextId,
      phase: "installing",
      error: null,
      deploymentUuid: "deployment-2",
    });
    network({ status: "finished" });
    await t.action(internal.updates.pollCoolify, { id: nextId });
    expect(await t.query(internal.updates.coolifyOperation, { id: nextId })).toMatchObject({
      phase: "installed",
      error: null,
    });
    // Late results from the previous attempt cannot overwrite the completed one.
    await t.mutation(internal.updates.reportCoolify, { id, phase: "installed", error: null });
    expect(await t.query(internal.updates.coolifyOperation, { id })).toMatchObject({
      phase: "failed",
    });
  });

  it("reports deployment rejection so the owner can correct configuration and retry", async () => {
    vi.useFakeTimers();
    configure();
    const t = newTest();
    await seedWorkspace(t);
    const id = await t.mutation(internal.updates.beginCoolifyInstall, operation);
    network({ build_pack: "dockerfile", git_repository: "https://github.com/chark1es/Aulora" });
    await t.action(internal.updates.deployCoolify, { id });
    expect(await t.query(internal.updates.coolifyOperation, { id })).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("Docker Compose"),
    });
    await expect(t.mutation(internal.updates.beginCoolifyInstall, operation)).resolves.toBeTruthy();
  });
});
