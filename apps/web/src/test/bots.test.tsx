import { Permission } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotsSettings } from "../components/admin/bots/BotsSettings";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ url: "https://chat.example.com" }),
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

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    userId: "bot_bot-1",
    name: "Alpha",
    description: null,
    language: "typescript",
    enabled: true,
    grants: 0n,
    allowedChannelIds: null,
    status: "running",
    statusMessage: null,
    statusAt: 0,
    hasToken: false,
    tokenLast4: null,
    createdBy: "u1",
    createdAt: 0,
    revision: 1,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...summary(overrides),
    files: [{ path: "main.ts", content: "console.log(1)" }],
    envNames: [],
    ...overrides,
  };
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("bots:list", [summary()]);
  state.values.set("bots:get", detail());
  state.values.set("bots:runnerStatus", { online: true, lastSeenAt: 1 });
  state.values.set("bots:logs", []);
  state.values.set("channels:list", {
    page: [
      {
        id: "c1",
        kind: "text",
        categoryId: null,
        name: "general",
        topic: null,
        archived: false,
      },
    ],
    isDone: true,
    continueCursor: "",
  });
});

async function openDetail(user: ReturnType<typeof userEvent.setup>, tab?: string) {
  await user.click(screen.getByTestId("bot-row-bot-1"));
  if (tab !== undefined) {
    await user.click(await screen.findByRole("button", { name: tab }));
  }
}

describe("BotsSettings gate and list", () => {
  it("shows the permission hint without ManageBots", () => {
    render(<BotsSettings canManageBots={false} />);
    expect(screen.getByTestId("bots-locked")).toHaveTextContent("Manage Bots permission");
    expect(screen.queryByTestId("bots-settings")).not.toBeInTheDocument();
  });

  it("renders each bot with its language, status and enable switch", () => {
    state.values.set("bots:list", [
      summary({ id: "a", name: "Alpha", language: "python", status: "running", enabled: true }),
      summary({
        id: "b",
        name: "Beta",
        status: "crashed",
        statusMessage: "exit 1",
        enabled: false,
      }),
    ]);
    render(<BotsSettings canManageBots />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByTestId("bot-status-running")).toHaveTextContent("Running");
    expect(screen.getByTestId("bot-status-crashed")).toHaveTextContent("Crashed");
    expect(screen.getByTestId("bot-status-crashed")).toHaveTextContent("exit 1");
    expect(screen.getByRole("switch", { name: "Enable Alpha" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Enable Beta" })).not.toBeChecked();
  });

  it("shows the runner-offline banner", () => {
    state.values.set("bots:runnerStatus", { online: false, lastSeenAt: null });
    render(<BotsSettings canManageBots />);
    expect(screen.getByTestId("bot-runner-offline")).toHaveTextContent(
      "docker compose --profile bots up -d",
    );
  });

  it("toggles a bot's enabled flag", async () => {
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await user.click(screen.getByRole("switch", { name: "Enable Alpha" }));
    expect(state.mutations.get("bots:update")).toHaveBeenCalledWith({
      botId: "bot-1",
      enabled: false,
    });
  });
});

describe("Bot create flow", () => {
  it("validates the name and then opens the new bot", async () => {
    state.mutations.set("bots:create", vi.fn().mockResolvedValue({ botId: "bot-2" }));
    state.values.set("bots:get", detail({ id: "bot-2", name: "Helper" }));
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);

    await user.click(screen.getByRole("button", { name: "New bot" }));
    const dialog = await screen.findByRole("dialog", { name: "New bot" });
    await user.click(within(dialog).getByRole("button", { name: "Create bot" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Give the bot a name");
    expect(state.mutations.get("bots:create")).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Name"), "Helper");
    await user.click(within(dialog).getByRole("button", { name: "Create bot" }));

    await waitFor(() =>
      expect(state.mutations.get("bots:create")).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Helper", language: "typescript", template: "hello" }),
      ),
    );
    expect(await screen.findByRole("heading", { name: "Helper" })).toBeInTheDocument();
  });
});

describe("Bot permissions tab", () => {
  it("toggles grantable bits, disables blocked ones and saves the payload", async () => {
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await openDetail(user, "Permissions");

    expect(screen.getByTestId("bot-no-permissions")).toHaveTextContent("can do nothing yet");
    await user.click(screen.getByLabelText("Send messages"));
    expect(screen.queryByTestId("bot-no-permissions")).not.toBeInTheDocument();

    const blocked = screen.getByLabelText("Administrator");
    expect(blocked).toBeDisabled();
    expect(
      screen.getByText("Would give the bot full control of the workspace."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save permissions" }));
    expect(state.mutations.get("bots:setPermissions")).toHaveBeenCalledWith({
      botId: "bot-1",
      grants: Permission.SendMessages,
      allowedChannelIds: null,
    });
  });

  it("saves a selected channel scope", async () => {
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await openDetail(user, "Permissions");

    await user.click(screen.getByRole("radio", { name: "Only selected channels" }));
    await user.click(screen.getByRole("button", { name: "Add a channel" }));
    await user.click(screen.getByRole("option", { name: /general/ }));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    expect(state.mutations.get("bots:setPermissions")).toHaveBeenCalledWith({
      botId: "bot-1",
      grants: 0n,
      allowedChannelIds: ["c1"],
    });
  });
});

describe("Bot token tab", () => {
  it("shows a new token once and then dismisses it", async () => {
    state.mutations.set("bots:rotateToken", vi.fn().mockResolvedValue({ token: "abt_secret" }));
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await openDetail(user, "Token");

    await user.click(screen.getByRole("button", { name: "Generate token" }));
    expect(await screen.findByTestId("bot-token-value")).toHaveTextContent("abt_secret");

    await user.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByTestId("bot-token-value")).not.toBeInTheDocument();
  });
});

describe("Bot environment tab", () => {
  it("never renders a value and saves names only", async () => {
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await openDetail(user, "Environment");

    await user.type(screen.getByLabelText("Name"), "API_KEY");
    await user.type(screen.getByLabelText("Value"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Set variable" }));

    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.queryByText("s3cret")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("s3cret")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save environment" }));
    expect(state.mutations.get("bots:setEnv")).toHaveBeenCalledWith({
      botId: "bot-1",
      set: [{ name: "API_KEY", value: "s3cret" }],
      remove: [],
    });
  });
});

describe("Bot code tab", () => {
  it("rejects a bad path and saves only the changed file", async () => {
    const user = userEvent.setup();
    render(<BotsSettings canManageBots />);
    await openDetail(user, "Code");

    await user.click(screen.getByRole("button", { name: "Add file" }));
    const dialog = await screen.findByRole("dialog", { name: "Add file" });
    const path = within(dialog).getByLabelText("File path");
    await user.type(path, "../evil.ts");
    await user.click(within(dialog).getByRole("button", { name: "Add file" }));
    expect(screen.getByRole("alert")).toHaveTextContent("relative");

    await user.clear(path);
    await user.type(path, "lib/util.ts");
    await user.click(within(dialog).getByRole("button", { name: "Add file" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("lib/util.ts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save files" }));
    expect(state.mutations.get("bots:saveFiles")).toHaveBeenCalledWith({
      botId: "bot-1",
      files: [{ path: "lib/util.ts", content: "" }],
    });
  });
});
