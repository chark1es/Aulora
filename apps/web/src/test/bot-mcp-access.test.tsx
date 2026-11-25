import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotsSettings } from "../components/admin/bots/BotsSettings";

const ORIGIN = "https://chat.example.com";
const TOKEN = "amt_TestTokenValueThatIsOnlyShownOnce0123456789a";
const DAY = 86_400_000;

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) {
      state.mutations.set(name, vi.fn().mockResolvedValue(undefined));
    }
    return state.mutations.get(name);
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));

function bot(id: string, name: string) {
  return {
    id,
    userId: `bot_${id}`,
    name,
    description: null,
    language: "typescript",
    enabled: true,
    grants: 0n,
    allowedChannelIds: null,
    status: "stopped",
    statusMessage: null,
    statusAt: 0,
    hasToken: false,
    tokenLast4: null,
    createdBy: "u1",
    createdAt: 0,
    revision: 1,
  };
}

function token(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "t1",
    name: "Laptop",
    scope: "read",
    botIds: null,
    tokenLast4: "AbCd",
    createdBy: "u1",
    createdByName: "Ada",
    createdAt: now - 2 * DAY,
    expiresAt: now + 10 * DAY,
    lastUsedAt: now - 3 * 60 * 60_000,
    expired: false,
    ...overrides,
  };
}

function mutationMock(name: string) {
  const mock = state.mutations.get(name);
  if (mock === undefined) {
    throw new Error(`${name} was never requested`);
  }
  return mock;
}

async function openMcp(user: ReturnType<typeof userEvent.setup>) {
  render(<BotsSettings canManageBots origin={ORIGIN} />);
  await user.click(screen.getByRole("button", { name: "MCP access" }));
  await screen.findByTestId("bot-mcp");
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("bots:list", [bot("b1", "Alpha"), bot("b2", "Beta")]);
  state.values.set("bots:runnerStatus", { online: true, lastSeenAt: 1 });
  state.values.set("botMcpTokens:list", []);
});

describe("MCP access placement", () => {
  it("is reached from the bots list and returns to it", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    expect(screen.getByRole("heading", { name: "MCP access" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bots" }));
    expect(screen.getByTestId("bots-settings")).toBeInTheDocument();
  });

  it("is not offered without Manage bots", () => {
    render(<BotsSettings canManageBots={false} origin={ORIGIN} />);
    expect(screen.queryByRole("button", { name: "MCP access" })).not.toBeInTheDocument();
  });
});

describe("MCP token list", () => {
  it("explains MCP access when there are no tokens", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    expect(screen.getByRole("heading", { name: "No MCP tokens yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New token" })).toBeInTheDocument();
  });

  it("shows scope, bots, last four, creator, expiry and last use", async () => {
    state.values.set("botMcpTokens:list", [
      token(),
      token({ id: "t2", name: "CI", scope: "write", botIds: ["b1", "b2"], lastUsedAt: null }),
    ]);
    const user = userEvent.setup();
    await openMcp(user);

    const first = within(screen.getByTestId("mcp-token-t1"));
    expect(first.getByText("Read only")).toBeInTheDocument();
    expect(first.getByText("All bots")).toBeInTheDocument();
    expect(first.getByText("amt_…AbCd")).toBeInTheDocument();
    expect(first.getByText(/^Ada on /)).toBeInTheDocument();
    expect(first.getByText(/^Expires in 10 days \(/)).toBeInTheDocument();
    expect(first.getByText("3 h ago")).toBeInTheDocument();

    const second = within(screen.getByTestId("mcp-token-t2"));
    expect(second.getByText("Read & write")).toBeInTheDocument();
    expect(second.getByText("Alpha, Beta")).toBeInTheDocument();
    expect(second.getByText("Never")).toBeInTheDocument();
  });

  it("marks an expired token", async () => {
    state.values.set("botMcpTokens:list", [
      token({ expired: true, expiresAt: Date.now() - DAY, lastUsedAt: null }),
    ]);
    const user = userEvent.setup();
    await openMcp(user);
    const row = within(screen.getByTestId("mcp-token-t1"));
    expect(row.getByText("Expired")).toBeInTheDocument();
    expect(row.getByText(/^Expired /, { selector: "dd" })).toBeInTheDocument();
  });
});

describe("New MCP token", () => {
  it("rejects an empty name", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "New token" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the token a name");
    expect(mutationMock("botMcpTokens:create")).not.toHaveBeenCalled();
  });

  it("requires a bot when access is limited to selected bots", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Name"), "Laptop");
    await user.click(screen.getByRole("radio", { name: /Selected bots/ }));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose at least one bot");
    expect(mutationMock("botMcpTokens:create")).not.toHaveBeenCalled();
  });

  it("creates a token, shows it with the setup once, and forgets it on close", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Name"), "  Laptop ");
    await user.click(screen.getByRole("radio", { name: /Read & write/ }));
    await user.click(screen.getByRole("radio", { name: /Selected bots/ }));
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    const create = mutationMock("botMcpTokens:create");
    create.mockResolvedValue({ tokenId: "t9", token: TOKEN });
    await user.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: "Laptop",
        scope: "write",
        botIds: ["b2"],
        expiresInDays: 30,
      });
    });
    expect(await screen.findByTestId("mcp-token-value")).toHaveTextContent(TOKEN);
    expect(screen.getByText(/You will not see it again/)).toBeInTheDocument();
    const claude = screen.getByTestId("mcp-snippet-claude");
    expect(claude).toHaveTextContent(
      `claude mcp add --transport http aulora ${ORIGIN}/api/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
    const json = JSON.parse(screen.getByTestId("mcp-snippet-json").textContent ?? "") as unknown;
    expect(json).toEqual({
      mcpServers: {
        aulora: {
          type: "http",
          url: `${ORIGIN}/api/mcp`,
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      },
    });

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByTestId("mcp-reveal")).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(TOKEN);
  });

  it("shows a failed creation without revealing anything", async () => {
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Name"), "Laptop");
    mutationMock("botMcpTokens:create").mockRejectedValue(new Error("Too many tokens"));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tokens");
    expect(screen.queryByTestId("mcp-reveal")).not.toBeInTheDocument();
  });
});

describe("Revoke MCP token", () => {
  it("asks first, then revokes", async () => {
    state.values.set("botMcpTokens:list", [token()]);
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    expect(mutationMock("botMcpTokens:revoke")).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke token" }));
    await waitFor(() => {
      expect(mutationMock("botMcpTokens:revoke")).toHaveBeenCalledWith({ tokenId: "t1" });
    });
  });

  it("does nothing when the confirmation is cancelled", async () => {
    state.values.set("botMcpTokens:list", [token()]);
    const user = userEvent.setup();
    await openMcp(user);
    await user.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mutationMock("botMcpTokens:revoke")).not.toHaveBeenCalled();
  });
});
