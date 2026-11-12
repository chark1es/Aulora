import type { ConvexReactClient } from "convex/react";
import { afterEach, expect, it, vi } from "vitest";
import { type AuloraAuthClient, authActionsFromClient } from "../lib/auth-client";
import { registerWebPushDevice, restoreWebPushDevice, revokeWebPushDevice } from "../lib/web-push";

afterEach(() => vi.unstubAllGlobals());
it("revokes this browser's device before signing out", async () => {
  const subscription = {
    toJSON: () => ({ endpoint: "https://push.example/device", keys: { p256dh: "p", auth: "a" } }),
  };
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: async () => ({ pushManager: { getSubscription: async () => subscription } }),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  const calls: string[] = [];
  const mutation = vi.fn(async (_query: unknown, args: { deviceId?: string }) => {
    calls.push(args.deviceId ?? "register");
    return { deviceId: "browser-device" };
  });
  const client = { mutation } as unknown as ConvexReactClient;
  expect(await registerWebPushDevice(client, "key")).toBe(true);
  const auth = {
    signOut: async () => {
      calls.push("signout");
      return {};
    },
  } as unknown as AuloraAuthClient;
  await authActionsFromClient(auth, () => revokeWebPushDevice(client)).signOut();
  expect(calls).toEqual(["register", "browser-device", "signout"]);
});
it("signs out even when push revocation fails", async () => {
  const signOut = vi.fn(async () => ({}));
  const auth = { signOut } as unknown as AuloraAuthClient;
  await expect(
    authActionsFromClient(auth, async () => {
      throw new Error("offline");
    }).signOut(),
  ).resolves.toEqual({ error: null });
  expect(signOut).toHaveBeenCalledOnce();
});

it("revokes the persisted row after reload, scoped to origin and account", async () => {
  localStorage.clear();
  const mutation = vi.fn(async () => undefined);
  const client = { url: "https://server.example/api", mutation } as unknown as ConvexReactClient;
  localStorage.setItem("aulora.push.v1:https%3A%2F%2Fserver.example:alice", "previous-device");
  localStorage.setItem("aulora.push.v1:https%3A%2F%2Fserver.example:bob", "other-device");
  await revokeWebPushDevice(client, "alice");
  expect(mutation).toHaveBeenCalledWith(expect.anything(), { deviceId: "previous-device" });
  expect(localStorage.getItem("aulora.push.v1:https%3A%2F%2Fserver.example:bob")).toBe(
    "other-device",
  );
});

it("waits for an in-flight upsert before signing out", async () => {
  const subscription = {
    toJSON: () => ({ endpoint: "https://push.example/device", keys: { p256dh: "p", auth: "a" } }),
  };
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: async () => ({
        pushManager: { getSubscription: async () => subscription },
      }),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  let finish: ((value: { deviceId: string }) => void) | undefined;
  const calls: string[] = [];
  const mutation = vi.fn((_query: unknown, args: { deviceId?: string }) => {
    calls.push(args.deviceId ?? "register");
    if (args.deviceId !== undefined) return Promise.resolve({});
    return new Promise<{ deviceId: string }>((resolve) => {
      finish = resolve;
    });
  });
  const client = { url: "https://server.example", mutation } as unknown as ConvexReactClient;
  const pending = registerWebPushDevice(client, "key", "alice");
  await vi.waitFor(() => expect(finish).toBeDefined());
  const auth = {
    signOut: async () => {
      calls.push("signout");
      return {};
    },
  } as unknown as AuloraAuthClient;
  const leaving = authActionsFromClient(auth, () => revokeWebPushDevice(client, "alice")).signOut();
  await Promise.resolve();
  expect(calls).toEqual(["register"]);
  finish?.({ deviceId: "pending-device" });
  await pending;
  await leaving;
  expect(calls).toEqual(["register", "pending-device", "signout"]);
});

it("bounds revocation so an unavailable server cannot block sign-out", async () => {
  vi.useFakeTimers();
  try {
    const signOut = vi.fn(async () => ({}));
    const auth = { signOut } as unknown as AuloraAuthClient;
    const leaving = authActionsFromClient(auth, () => new Promise<void>(() => undefined)).signOut();
    await vi.advanceTimersByTimeAsync(1000);
    await leaving;
    expect(signOut).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["returned", "thrown"])("restores push after a %s sign-out failure", async (kind) => {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: async () => ({
        pushManager: {
          getSubscription: async () => ({
            toJSON: () => ({
              endpoint: "https://push.example/device",
              keys: { p256dh: "p", auth: "a" },
            }),
          }),
        },
      }),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  const mutation = vi.fn(async () => ({ deviceId: "device" }));
  const client = {
    url: "https://server.example",
    mutation,
    query: vi.fn(async () => ({ webPush: { publicKey: "key" } })),
  } as unknown as ConvexReactClient;
  await registerWebPushDevice(client, "key", "alice");
  const auth = {
    signOut: async () => {
      if (kind === "thrown") throw new Error("offline");
      return { error: { message: "offline" } };
    },
  } as unknown as AuloraAuthClient;
  const actions = authActionsFromClient(
    auth,
    () => revokeWebPushDevice(client, "alice"),
    () => restoreWebPushDevice(client, "alice"),
  );
  if (kind === "thrown") await expect(actions.signOut()).rejects.toThrow("offline");
  else expect((await actions.signOut()).error).not.toBeNull();
  await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(3));
  expect(mutation.mock.calls.at(-1)).toEqual([
    expect.anything(),
    expect.objectContaining({ platform: "web" }),
  ]);
});

it("revokes a row created after sign-out's bounded wait expires", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: async () => ({
          pushManager: {
            getSubscription: async () => ({
              toJSON: () => ({
                endpoint: "https://push.example/late",
                keys: { p256dh: "p", auth: "a" },
              }),
            }),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", class {});
    let finish: (value: { deviceId: string }) => void = () => {};
    const mutation = vi.fn((_query: unknown, args: { deviceId?: string }) =>
      args.deviceId === undefined
        ? new Promise<{ deviceId: string }>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({}),
    );
    const client = { mutation } as unknown as ConvexReactClient;
    const pending = registerWebPushDevice(client, "key");
    await vi.advanceTimersByTimeAsync(0);
    const signOut = vi.fn(async () => ({}));
    const leaving = authActionsFromClient({ signOut } as unknown as AuloraAuthClient, () =>
      revokeWebPushDevice(client),
    ).signOut();
    await vi.advanceTimersByTimeAsync(1000);
    await leaving;
    expect(signOut).toHaveBeenCalledOnce();
    finish({ deviceId: "late-device" });
    expect(await pending).toBe(false);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), { deviceId: "late-device" });
  } finally {
    vi.useRealTimers();
  }
});

it("restores a failed sign-out even when its revocation wait timed out", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: async () => ({
          pushManager: {
            getSubscription: async () => ({
              toJSON: () => ({
                endpoint: "https://push.example/still-signed-in",
                keys: { p256dh: "p", auth: "a" },
              }),
            }),
          },
        }),
      },
    });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", class {});
    let finish: (value: { deviceId: string }) => void = () => {};
    const mutation = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ deviceId: string }>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ deviceId: "restored" });
    const client = {
      url: "https://server.example",
      mutation,
      query: vi.fn(async () => ({ webPush: { publicKey: "key" } })),
    } as unknown as ConvexReactClient;
    const pending = registerWebPushDevice(client, "key", "alice");
    await vi.advanceTimersByTimeAsync(0);
    const auth = {
      signOut: async () => ({ error: { message: "offline" } }),
    } as unknown as AuloraAuthClient;
    const leaving = authActionsFromClient(
      auth,
      () => revokeWebPushDevice(client, "alice"),
      () => restoreWebPushDevice(client, "alice"),
    ).signOut();
    await vi.advanceTimersByTimeAsync(1000);
    await leaving;
    await vi.advanceTimersByTimeAsync(0);
    finish({ deviceId: "original" });
    expect(await pending).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ platform: "web" }),
    );
  } finally {
    vi.useRealTimers();
  }
});
