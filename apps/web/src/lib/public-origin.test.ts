import { afterEach, describe, expect, it } from "vitest";
import {
  authCallbackUrl,
  publicOrigin,
  publicOriginOrNull,
  publicUrl,
  setActiveServerBaseUrl,
} from "./public-origin";

const globalWithTauri = globalThis as { __TAURI__?: unknown };
const saved = globalWithTauri.__TAURI__;

function enterDesktop(): void {
  globalWithTauri.__TAURI__ = { core: { invoke: () => Promise.resolve() } };
}

afterEach(() => {
  if (saved === undefined) {
    delete globalWithTauri.__TAURI__;
  } else {
    globalWithTauri.__TAURI__ = saved;
  }
  setActiveServerBaseUrl(undefined);
});

describe("publicOrigin", () => {
  it("is the page origin in a browser", () => {
    setActiveServerBaseUrl("https://chat.acme.com");
    expect(publicOrigin()).toBe(window.location.origin);
  });

  it("is the workspace origin inside the desktop shell", () => {
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com");
    expect(publicOrigin()).toBe("https://chat.acme.com");
  });

  it("drops a path from the workspace base URL", () => {
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com/aulora/");
    expect(publicOrigin()).toBe("https://chat.acme.com");
  });

  it("never returns the shell's own origin", () => {
    enterDesktop();
    expect(publicOrigin()).toBe("");
    setActiveServerBaseUrl("not a url");
    expect(publicOrigin()).toBe("");
  });

  it("forgets the workspace when the base URL is cleared", () => {
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com");
    setActiveServerBaseUrl(undefined);
    expect(publicOrigin()).toBe("");
  });
});

describe("publicOriginOrNull", () => {
  it("is null until the shell knows the workspace", () => {
    enterDesktop();
    expect(publicOriginOrNull()).toBeNull();
  });

  it("is the workspace origin once it is known", () => {
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com");
    expect(publicOriginOrNull()).toBe("https://chat.acme.com");
  });
});

describe("publicUrl", () => {
  it("builds an absolute workspace URL from a path", () => {
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com");
    expect(publicUrl("/?channel=c1")).toBe("https://chat.acme.com/?channel=c1");
    expect(publicUrl("invite/ABC")).toBe("https://chat.acme.com/invite/ABC");
  });

  it("builds nothing while the shell has no workspace origin", () => {
    enterDesktop();
    expect(publicUrl("/?channel=c1")).toBeNull();
  });

  it("uses the page origin in a browser", () => {
    expect(publicUrl("/invite/ABC")).toBe(`${window.location.origin}/invite/ABC`);
  });
});

describe("authCallbackUrl", () => {
  it("returns the page origin the provider round trip returns to", () => {
    expect(authCallbackUrl()).toBe(window.location.origin);
  });

  it("stays on the webview origin inside the shell", () => {
    // The OAuth round trip has to land in the webview, so this is the one place
    // the shell origin is named; shared links never use it.
    enterDesktop();
    setActiveServerBaseUrl("https://chat.acme.com");
    expect(authCallbackUrl()).toBe(window.location.origin);
    expect(publicOrigin()).toBe("https://chat.acme.com");
  });
});
