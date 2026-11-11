import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["../src/lib/*.ts", "!../src/lib/*.test.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("offline review demo client", () => {
  // The demo crashed on open (seen on the Android emulator) once a hook started
  // watching a live query through `runtime.client`; the stub must cover every
  // client method the shared hooks call.
  it("stubs every Convex client method the shared runtime hooks call", () => {
    const session = sources["../src/lib/review-demo-session.ts"] ?? "";
    const stub = /const DEMO_CLIENT = \{([\s\S]*?)\} as unknown as ConvexReactClient;/.exec(
      session,
    );
    expect(stub).not.toBeNull();
    const used = new Set<string>();
    for (const source of Object.values(sources))
      for (const match of source.matchAll(/runtime\.client\.(\w+)\(/g))
        used.add(match[1] as string);
    const stubbed = new Set(stub?.[1]?.match(/\w+/g) ?? []);
    const missing = [...used].filter((method) => !stubbed.has(method));
    expect(missing).toEqual([]);
  });
});
