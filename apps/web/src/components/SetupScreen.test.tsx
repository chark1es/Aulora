import type { ServerProfile } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAction } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthActions } from "../lib/auth-client";
import { SetupScreen } from "./SetupScreen";

const initialize = vi.hoisted(() => vi.fn(() => Promise.resolve({ ownerId: "owner-1" })));
const useQueryMock = vi.hoisted(() => vi.fn(() => undefined));
vi.mock("convex/react", () => ({ useAction: vi.fn(() => initialize), useQuery: useQueryMock }));

vi.mock("./BlobatarHero", () => ({
  BlobatarHero: () => null,
}));

const profile: ServerProfile = {
  id: "https://chat.acme.com",
  baseUrl: "https://chat.acme.com",
  name: "Acme Chat",
  iconSeed: "aulora:server:acme",
  version: "0.1.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  auth: { local: { enabled: true, signup: true }, providers: [] },
  addedAt: 0,
};

function fakeActions(): AuthActions {
  return {
    signInEmail: vi.fn(() => Promise.resolve({ error: null })),
    signUpEmail: vi.fn(() => Promise.resolve({ error: null })),
    signInSocial: vi.fn(() => Promise.resolve({ error: null })),
    signInOAuth2: vi.fn(() => Promise.resolve({ error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
}

describe("SetupScreen", () => {
  beforeEach(() => {
    initialize.mockClear();
    useQueryMock.mockReturnValue(undefined);
    vi.mocked(useAction).mockReturnValue(initialize as never);
  });

  it("asks for the printed token and shows the strength of a weak password", async () => {
    render(<SetupScreen profile={profile} actions={fakeActions()} />);

    expect(screen.getByLabelText("Setup token")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Acme Chat");
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Password"), "password");
    expect(screen.getByText(/too common|mix at least three/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeDisabled();
  });

  it("validates against the deployment’s advertised password minimum", async () => {
    const strongerProfile: ServerProfile = {
      ...profile,
      auth: { local: { enabled: true, signup: true, minPasswordLength: 12 }, providers: [] },
    };
    render(<SetupScreen profile={strongerProfile} actions={fakeActions()} />);

    await userEvent.type(screen.getByLabelText("Password"), "Abcdefg1!x");
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeDisabled();
  });

  it("reads the live public config’s password minimum over the stored profile", async () => {
    useQueryMock.mockReturnValue({ auth: { local: { minPasswordLength: 14 } } } as never);
    render(<SetupScreen profile={profile} actions={fakeActions()} />);

    await userEvent.type(screen.getByLabelText("Password"), "Abcdefg1!xyz");
    expect(screen.getByText("Use at least 14 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeDisabled();
  });

  it("claims the instance, signs the owner in and normalizes whitespace", async () => {
    const actions = fakeActions();
    render(<SetupScreen profile={profile} actions={actions} />);

    await userEvent.type(screen.getByLabelText("Setup token"), "  token-123  ");
    await userEvent.clear(screen.getByLabelText("Workspace name"));
    await userEvent.type(screen.getByLabelText("Workspace name"), "Acme HQ");
    await userEvent.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText("Email"), "ada@acme.com");
    await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-Battery-9");

    const submit = screen.getByRole("button", { name: "Create owner account" });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith({
        token: "token-123",
        name: "Acme HQ",
        email: "ada@acme.com",
        password: "Correct-Horse-Battery-9",
        displayName: "Ada Lovelace",
      });
    });
    expect(actions.signInEmail).toHaveBeenCalledWith({
      email: "ada@acme.com",
      password: "Correct-Horse-Battery-9",
    });
  });

  it("shows the server’s rejection without losing the form", async () => {
    initialize.mockRejectedValueOnce(new Error("Invalid setup token"));
    render(<SetupScreen profile={profile} actions={fakeActions()} />);

    await userEvent.type(screen.getByLabelText("Setup token"), "wrong");
    await userEvent.clear(screen.getByLabelText("Workspace name"));
    await userEvent.type(screen.getByLabelText("Workspace name"), "Acme HQ");
    await userEvent.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText("Email"), "ada@acme.com");
    await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-Battery-9");
    await userEvent.click(screen.getByRole("button", { name: "Create owner account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid setup token");
    expect(screen.getByLabelText("Setup token")).toHaveValue("wrong");
  });
});
