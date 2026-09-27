import { afterEach, describe, expect, it } from "vitest";
import { desktopPlatform, isDesktop, parseDeepLink } from "./desktop";

describe("parseDeepLink", () => {
  it("parses connect deep links in query and path forms", () => {
    expect(parseDeepLink("aulora://connect?server=chat.acme.com")).toEqual({
      kind: "connect",
      server: "chat.acme.com",
    });
    expect(parseDeepLink("aulora://connect/chat.acme.com")).toEqual({
      kind: "connect",
      server: "chat.acme.com",
    });
  });

  it("parses invite deep links in query and path forms", () => {
    expect(parseDeepLink("aulora://invite?code=ABC123")).toEqual({
      kind: "invite",
      code: "ABC123",
    });
    expect(parseDeepLink("aulora://invite/ABC123")).toEqual({
      kind: "invite",
      code: "ABC123",
    });
  });

  it("rejects other schemes, hosts and missing parameters", () => {
    expect(parseDeepLink("https://connect?server=chat.acme.com")).toBeNull();
    expect(parseDeepLink("aulora://unknown?x=1")).toBeNull();
    expect(parseDeepLink("aulora://connect")).toBeNull();
    expect(parseDeepLink("not a url")).toBeNull();
  });

  it("parses https universal links for connect and invite", () => {
    expect(parseDeepLink("https://chat.acme.com/connect?server=chat.acme.com")).toEqual({
      kind: "connect",
      server: "chat.acme.com",
    });
    expect(parseDeepLink("https://chat.acme.com/invite/ABC123")).toEqual({
      kind: "invite",
      code: "ABC123",
    });
    expect(parseDeepLink("https://chat.acme.com/other")).toBeNull();
    expect(parseDeepLink("ftp://chat.acme.com/connect?server=x")).toBeNull();
  });
});

describe("isDesktop", () => {
  const globalWithTauri = globalThis as { __TAURI__?: unknown };
  const saved = globalWithTauri.__TAURI__;

  afterEach(() => {
    if (saved === undefined) {
      delete globalWithTauri.__TAURI__;
    } else {
      globalWithTauri.__TAURI__ = saved;
    }
  });

  it("is false without the Tauri global", () => {
    delete globalWithTauri.__TAURI__;
    expect(isDesktop()).toBe(false);
  });

  it("is true with the Tauri global", () => {
    globalWithTauri.__TAURI__ = { core: { invoke: () => Promise.resolve() } };
    expect(isDesktop()).toBe(true);
  });
});

describe("desktopPlatform", () => {
  it("recognises the three desktop targets from the webview user agent", () => {
    expect(
      desktopPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("macos");
    expect(
      desktopPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140.0"),
    ).toBe("windows");
    expect(desktopPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
  });
});
