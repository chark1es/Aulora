import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activateProfileInStore, debugLog, type ProfileStore, userFacingError } from "@aulora/core";
import { act, renderHook } from "@testing-library/react";
import { useCallback } from "react";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { useAccountScope as useMobileScope } from "../../../mobile/src/lib/use-account-scope";
import { useAccountScope } from "../lib/use-account-scope";

afterEach(() => debugLog.clear());

it("invalidates outgoing actions before workspace persistence and teardown", async () => {
  let rejectAction!: (error: unknown) => void;
  let finishPersistence!: () => void;
  const action = new Promise<void>((_resolve, reject) => {
    rejectAction = reject;
  });
  const persistence = new Promise<void>((resolve) => {
    finishPersistence = resolve;
  });
  const view = renderHook(() => useAccountScope("A"));
  const pendingAction = category(view.result.current, () => action)("synthetic category");
  const store = {
    getActive: async () => ({ id: "A" }),
    setActive: () => persistence,
  } as unknown as ProfileStore;
  const activation = activateProfileInStore(store, "B");
  await Promise.resolve(); // finish the active-profile read before persistence begins
  // A is still mounted while the real activation helper awaits the store.
  expect(view.result.current.active).toBe(false);
  rejectAction(new Error("A-only transition sentinel"));
  await pendingAction;
  expect(debugLog.snapshot()).toEqual([]);
  finishPersistence();
  await activation;
  view.unmount();
  const next = renderHook(() => useAccountScope("B"));
  next.result.current.record("B", "current B");
  debugLog.clear(); // manual Clear must not disable B's capture
  next.result.current.record("B", "current failure after clear");
  expect(debugLog.report("B", "")).not.toContain("A-only transition sentinel");
  expect(debugLog.report("B", "")).toContain("current failure after clear");
  next.unmount();
});

// Exercise the actual category mutation continuation with a real render-bound
// account scope. A mutation is the only deferred network boundary.
function category(scope: ReturnType<typeof useAccountScope>, mutate: () => Promise<void>) {
  const source = readFileSync(resolve(process.cwd(), "src/components/chat/ChatView.tsx"), "utf8");
  const start = source.indexOf("  const submitCategory = async");
  const end = source.indexOf("\n  const saveUserSettings", start);
  const callbackStart = source.indexOf("  const errorMessage = useCallback(");
  const callbackEnd = source.indexOf("\n  const chat = useChat();", callbackStart);
  const code = ts.transpileModule(
    source.slice(callbackStart, callbackEnd) + source.slice(start, end),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const bindings = {
    useCallback: (callback: unknown) => callback,
    actionScope: scope,
    userFacingError,
    categoryModal: null,
    createCategory: mutate,
    updateCategory: mutate,
    closeCategoryModal: vi.fn(),
    setCategoryError: vi.fn(),
    setCategoryBusy: vi.fn(),
  };
  return new Function(...Object.keys(bindings), `${code}; return submitCategory;`)(
    ...Object.values(bindings),
  ) as (name: string) => Promise<void>;
}

it("drops an old category failure after the shell unmounts", async () => {
  let reject!: (error: unknown) => void;
  const request = new Promise<void>((_resolve, rej) => {
    reject = rej;
  });
  const view = renderHook(() => useAccountScope("A"));
  const pending = category(view.result.current, () => request)("synthetic category");
  view.unmount();
  debugLog.clear();
  debugLog.record("B", "current B");
  reject(new Error("A-only category sentinel"));
  await pending;
  expect(debugLog.report("B", "")).not.toContain("A-only category sentinel");
});

it("still records the current category failure", async () => {
  const view = renderHook(() => useAccountScope("A"));
  await category(view.result.current, async () => {
    throw new Error("current category failure");
  })("synthetic category");
  expect(debugLog.report("A", "")).toContain("current category failure");
  view.unmount();
});

for (const useScope of [useAccountScope, useMobileScope]) {
  it("old action callbacks keep their closed scope when identity changes", () => {
    const view = renderHook(
      ({ id }) => {
        const scope = useScope(id);
        return useCallback((error: unknown) => scope.record("ui.action", error), [scope]);
      },
      { initialProps: { id: "A" } },
    );
    const old = view.result.current;
    view.rerender({ id: "B" });
    debugLog.clear();
    act(() => old(new Error("A-only action sentinel")));
    expect(debugLog.snapshot()).toEqual([]);
    act(() => view.result.current(new Error("current B failure")));
    expect(debugLog.report("B", "")).toContain("current B failure");
    view.unmount();
  });
}
