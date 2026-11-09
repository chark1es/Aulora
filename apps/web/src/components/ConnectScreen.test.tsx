import { createServerProfile, debugLog, type WellKnown, webLocalStorageStore } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { ConnectScreen } from "./ConnectScreen";

const heroWatch = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("./BlobatarHero", () => ({
  BlobatarHero: (props: { readonly watch?: unknown }) => {
    heroWatch.current = props.watch;
    return null;
  },
}));

const wellKnown: WellKnown = {
  name: "Acme Chat",
  version: "0.1.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  iconSeed: "aulora:server:acme",
  auth: {
    local: { enabled: true, signup: false },
    providers: [{ id: "github", type: "oauth", displayName: "GitHub" }],
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  debugLog.clear();
});

describe("ConnectScreen", () => {
  for (const action of ["switch", "remove"] as const) {
    it(`clears previous account diagnostics when the connect screen performs ${action}`, async () => {
      const store = webLocalStorageStore({ storage: memoryStorage() });
      const profile = createServerProfile("https://chat.acme.com", wellKnown);
      await store.add(profile);
      render(<ConnectScreen store={store} />);
      const user = userEvent.setup();
      await screen.findByRole("button", { name: /Acme Chat.*chat.acme.com/ });
      debugLog.record("previous-account", "sentinel-old-account");
      await user.click(
        screen.getByRole("button", {
          name: action === "switch" ? /Acme Chat.*chat.acme.com/ : "Remove Acme Chat",
        }),
      );
      await waitFor(() =>
        expect(debugLog.report("new-account", "")).not.toContain("sentinel-old-account"),
      );
    });
  }

  it("normalizes the host, fetches well-known, shows the name and saves the profile", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(jsonResponse(wellKnown));
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = webLocalStorageStore({ storage: memoryStorage() });
    const onConnected = vi.fn();
    const user = userEvent.setup();

    render(<ConnectScreen store={store} onConnected={onConnected} />);
    await user.type(screen.getByLabelText("Server address"), "chat.acme.com/");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Acme Chat")).toBeInTheDocument();
    expect(calls[0]).toBe("https://chat.acme.com/.well-known/aulora.json");

    debugLog.record("previous-account", "sentinel-old-account");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(debugLog.report("new-account", "")).not.toContain("sentinel-old-account"),
    );
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect((await store.getActive())?.name).toBe("Acme Chat");
  });

  it("refuses an incompatible api version and does not save", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...wellKnown, apiVersion: 99 })));
    vi.stubGlobal("fetch", fetchMock);

    const store = webLocalStorageStore({ storage: memoryStorage() });
    const onConnected = vi.fn();
    const user = userEvent.setup();

    render(<ConnectScreen store={store} onConnected={onConnected} />);
    await user.type(screen.getByLabelText("Server address"), "chat.acme.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("supports v1");
    expect(onConnected).not.toHaveBeenCalled();
    expect(await store.getActive()).toBeUndefined();
  });

  it("rejects an invalid host without fetching", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(wellKnown)));
    vi.stubGlobal("fetch", fetchMock);

    const store = webLocalStorageStore({ storage: memoryStorage() });
    const user = userEvent.setup();

    render(<ConnectScreen store={store} />);
    await user.type(screen.getByLabelText("Server address"), "not a host");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid server address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("points the hero at the address field, then back at the pointer", async () => {
    const user = userEvent.setup();
    render(<ConnectScreen store={webLocalStorageStore({ storage: memoryStorage() })} />);

    const field = screen.getByLabelText("Server address");
    await user.click(field);
    expect(heroWatch.current).toBe(field);

    await user.tab();
    expect(heroWatch.current).toBe("pointer");
    expect(screen.queryByText(/team chat on your own server/)).toBeNull();
  });
});
