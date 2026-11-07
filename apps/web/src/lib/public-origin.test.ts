import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin, setActiveServerBaseUrl } from "./public-origin";

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
