import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { debugLog, recordDebugFailure } from "@aulora/core";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountScope } from "../lib/account-scope";

// Execute the actual screen controller with a hook boundary, avoiding RN's
// native module loader. Only platform/auth dependencies are substituted.
function controller(platform: "mobile" | "web") {
  const source = readFileSync(
    resolve(process.cwd(), "..", platform, "src/components/SignInScreen.tsx"),
    "utf8",
  );
  const name = platform === "mobile" ? "useSignInController" : "useSignInForm";
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(
    platform === "mobile" ? "\n/**" : "\ninterface ProviderStackProps",
    start,
  );
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cells: unknown[] = [];
  const effects: Array<{ deps: readonly unknown[]; cleanup?: (() => void) | undefined }> = [];
  let slot = 0;
  let effectSlot = 0;
  const patches = vi.fn();
  const provider = vi.fn();
  const notify = vi.fn();
  const clear = vi.fn(async () => undefined);
  const bindings = {
    useState(initial: unknown) {
      const index = slot++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [
        cells[index],
        (update: (current: unknown) => unknown) => {
          patches();
          cells[index] = update(cells[index]);
        },
      ];
    },
    useRef(initial: unknown) {
      const index = slot++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect(effect: () => (() => void) | undefined, deps: readonly unknown[]) {
      const index = effectSlot++;
      const previous = effects[index];
      if (previous && deps.every((dep, i) => dep === previous.deps[i])) return;
      previous?.cleanup?.();
      effects[index] = { deps, cleanup: effect() };
    },
    INITIAL: { mode: "sign-in", email: "", password: "", name: "", pending: null, error: null },
    createAccountScope,
    recordDebugFailure,
    authFailureDetail: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    describeAuthError: (error: unknown) => String(error),
    takeAuthErrorFromUrl: () => null,
    takeStoredAuthHandoffError: () => (platform === "mobile" ? Promise.resolve(null) : null),
    clearStoredAuthHandoffError: clear,
    subscribeAuthError: () => () => undefined,
    startProviderSignIn: provider,
    chooseProviderDelivery: async () => "external",
    notifyAuthChanged: notify,
  };
  type Form = {
    submitLocal?: () => Promise<void>;
    submit?: () => Promise<void>;
    signInWithProvider?: (id: string, type: string, name: string) => Promise<void>;
  };
  const hook = new Function(...Object.keys(bindings), `${code}; return ${name};`)(
    ...Object.values(bindings),
  ) as (...args: unknown[]) => Form;
  const authClient = {};
  const store = {};
  return {
    patches,
    provider,
    notify,
    clear,
    render(actions: unknown, site = "https://a.example") {
      slot = 0;
      effectSlot = 0;
      return platform === "mobile" ? hook(actions, authClient, store, site) : hook(actions, site);
    },
    unmount() {
      for (const effect of effects) effect.cleanup?.();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => debugLog.clear());
afterEach(() => debugLog.clear());

for (const platform of ["mobile", "web"] as const) {
  describe(`${platform} sign-in lifetime`, () => {
    for (const completion of ["reject", "result"] as const) {
      it(`drops a late ${completion} after unmount`, async () => {
        const boundary = controller(platform);
        const request = deferred<{ error: { message: string } | null }>();
        const form = boundary.render({ signInEmail: () => request.promise });
        const pending = (form.submitLocal ?? form.submit)?.();
        boundary.unmount();
        boundary.patches.mockClear();
        debugLog.clear();
        debugLog.record("B", "current B");
        if (completion === "reject") request.reject(new Error("A-only sentinel"));
        else request.resolve({ error: { message: "A-only sentinel" } });
        await pending;
        expect(debugLog.report("B", "")).not.toContain("A-only sentinel");
        expect(boundary.patches).not.toHaveBeenCalled();
      });
    }

    it("drops a failure when the same screen changes workspace", async () => {
      const boundary = controller(platform);
      const request = deferred<{ error: null }>();
      const actions = { signInEmail: () => request.promise };
      const form = boundary.render(actions);
      const pending = (form.submitLocal ?? form.submit)?.();
      boundary.render(actions, "https://b.example");
      boundary.patches.mockClear();
      request.reject(new Error("A-only workspace sentinel"));
      await pending;
      expect(debugLog.report("B", "")).not.toContain("A-only workspace sentinel");
      expect(boundary.patches).not.toHaveBeenCalled();
      boundary.unmount();
    });

    it("still records failures on the current screen", async () => {
      const boundary = controller(platform);
      const form = boundary.render({
        signInEmail: async () => {
          throw new Error("current failure");
        },
      });
      await (form.submitLocal ?? form.submit)?.();
      expect(debugLog.report(platform, "")).toContain("current failure");
      boundary.unmount();
    });
  });
}

it.each(["reject", "result", "success"])("drops a late mobile provider %s", async (completion) => {
  const boundary = controller("mobile");
  const request = deferred<unknown>();
  boundary.provider.mockReturnValue(request.promise);
  const form = boundary.render({});
  const pending = form.signInWithProvider?.("example", "oauth", "Example");
  await Promise.resolve(); // finish the delivery chooser and start auth
  expect(boundary.provider).toHaveBeenCalledOnce();
  boundary.unmount();
  boundary.patches.mockClear();
  debugLog.clear();
  if (completion === "reject") request.reject(new Error("A-only provider sentinel"));
  else
    request.resolve({
      status: completion === "result" ? "error" : "success",
      message: "A-only provider sentinel",
    });
  await pending;
  expect(debugLog.report("B", "")).not.toContain("A-only provider sentinel");
  expect(boundary.patches).not.toHaveBeenCalled();
  expect(boundary.notify).not.toHaveBeenCalled();
});
