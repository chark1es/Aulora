import { afterEach, expect, it } from "vitest";
import {
  captureDebugAccountOwnership,
  debugLog,
  resetDebugAccount,
  withDebugAccountTransition,
} from "../src/debug-log";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => resetDebugAccount());

it("manual clear preserves ownership; identity reset revokes it", () => {
  const owns = captureDebugAccountOwnership();
  debugLog.clear();
  expect(owns()).toBe(true);
  resetDebugAccount();
  expect(owns()).toBe(false);
  expect(captureDebugAccountOwnership()()).toBe(true);
});

it("revokes existing and pending-transition scopes on success", async () => {
  const ownsA = captureDebugAccountOwnership();
  const write = deferred();
  const pending = withDebugAccountTransition(() => write.promise);
  const duringTransition = captureDebugAccountOwnership();
  expect(ownsA()).toBe(false);
  expect(duringTransition()).toBe(false);
  write.resolve();
  await pending;
  expect(ownsA()).toBe(false);
  expect(duringTransition()).toBe(false);
  expect(captureDebugAccountOwnership()()).toBe(true);
});

it("restores the current account after persistence fails", async () => {
  const ownsA = captureDebugAccountOwnership();
  const write = deferred();
  const pending = withDebugAccountTransition(() => write.promise);
  expect(ownsA()).toBe(false);
  write.reject(new Error("storage unavailable"));
  await expect(pending).rejects.toThrow("storage unavailable");
  expect(ownsA()).toBe(true);
});

it.each(["first", "second"])(
  "restores A if concurrent failed transitions settle %s first",
  async (order) => {
    const ownsA = captureDebugAccountOwnership();
    const first = deferred();
    const second = deferred();
    const one = withDebugAccountTransition(() => first.promise).catch(() => undefined);
    const two = withDebugAccountTransition(() => second.promise).catch(() => undefined);
    if (order === "first") {
      first.reject(new Error("first failed"));
      await one;
      expect(ownsA()).toBe(false);
      second.reject(new Error("second failed"));
    } else {
      second.reject(new Error("second failed"));
      await two;
      expect(ownsA()).toBe(false);
      first.reject(new Error("first failed"));
    }
    await Promise.all([one, two]);
    expect(ownsA()).toBe(true);
  },
);

it("a stale failed transition cannot restore A after another transition succeeds", async () => {
  const ownsA = captureDebugAccountOwnership();
  const first = deferred();
  const one = withDebugAccountTransition(() => first.promise).catch(() => undefined);
  await withDebugAccountTransition(async () => undefined);
  const ownsB = captureDebugAccountOwnership();
  first.reject(new Error("stale failure"));
  await one;
  expect(ownsA()).toBe(false);
  expect(ownsB()).toBe(true);
});
