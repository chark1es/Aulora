import { webLocalStorageStore } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { ConnectScreen } from "./ConnectScreen";

const wellKnown = {
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
});

describe("ConnectScreen", () => {
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
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Acme Chat")).toBeInTheDocument();
    expect(calls[0]).toBe("https://chat.acme.com/.well-known/aulora.json");

    await user.click(screen.getByRole("button", { name: "Continue" }));
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
    await user.click(screen.getByRole("button", { name: "Connect" }));

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
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid server address");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
