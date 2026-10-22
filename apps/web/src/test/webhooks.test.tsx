import type { ChannelSummary } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhooksSettings } from "../components/admin/webhooks/WebhooksSettings";

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
}));

const channels: ChannelSummary[] = [
  { id: "c1", kind: "text", categoryId: null, name: "alerts", topic: null, archived: false },
  { id: "c2", kind: "voice", categoryId: null, name: "lounge", topic: null, archived: false },
  { id: "c3", kind: "text", categoryId: null, name: "old", topic: null, archived: true },
];

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh1",
    userId: "webhook_wh1",
    channelId: "c1",
    name: "Deploys",
    tokenLast4: "ab12",
    createdBy: "u1",
    createdAt: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

function mutationFor(name: string): ReturnType<typeof vi.fn> {
  const found = state.mutations.get(name);
  if (found === undefined) {
    throw new Error(`mutation ${name} was never used`);
  }
  return found;
}

function renderSettings(canManage = true) {
  return render(
    <WebhooksSettings
      canManageWebhooks={canManage}
      channels={channels}
      channelNames={undefined}
      origin="https://chat.example.com"
    />,
  );
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("webhooks:list", [webhook()]);
});

describe("WebhooksSettings", () => {
  it("shows a hint instead of the page without ManageWebhooks", () => {
    renderSettings(false);
    expect(screen.getByTestId("webhooks-locked")).toHaveTextContent("Manage Webhooks permission");
    expect(screen.queryByTestId("webhooks-settings")).not.toBeInTheDocument();
  });

  it("lists webhooks with their channel, secret tail and usage", () => {
    renderSettings();
    const row = screen.getByTestId("webhook-row-wh1");
    expect(within(row).getByText("Deploys")).toBeInTheDocument();
    expect(row).toHaveTextContent("#alerts");
    expect(row).toHaveTextContent("ends in ab12");
    expect(row).toHaveTextContent("Never used");
  });

  it("offers a first webhook when there are none", () => {
    state.values.set("webhooks:list", []);
    renderSettings();
    expect(screen.getByText("No webhooks yet")).toBeInTheDocument();
  });

  it("creates a webhook and shows its URL once", async () => {
    const user = userEvent.setup();
    state.mutations.set(
      "webhooks:create",
      vi.fn().mockResolvedValue({ webhookId: "wh9", token: "awh_secret" }),
    );
    renderSettings();

    await user.click(screen.getByRole("button", { name: "New webhook" }));
    await user.type(screen.getByLabelText("Name"), "  CI  ");
    await user.click(screen.getByLabelText("Channel"));
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["#alerts"]);
    await user.click(options[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Create webhook" }));

    await waitFor(() => {
      expect(screen.getByTestId("webhook-secret-url")).toHaveTextContent(
        "https://chat.example.com/api/webhooks/wh9/awh_secret",
      );
    });
    expect(mutationFor("webhooks:create")).toHaveBeenCalledWith({ channelId: "c1", name: "CI" });

    await user.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByTestId("webhook-secret")).not.toBeInTheDocument();
  });

  it("refuses an empty name before calling the server", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "New webhook" }));
    await user.click(screen.getByRole("button", { name: "Create webhook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the webhook a name.");
    expect(mutationFor("webhooks:create")).not.toHaveBeenCalled();
  });

  it("replaces the URL and shows the new one", async () => {
    const user = userEvent.setup();
    state.mutations.set("webhooks:rotateToken", vi.fn().mockResolvedValue({ token: "awh_new" }));
    renderSettings();

    await user.click(screen.getByRole("button", { name: "New URL" }));
    await waitFor(() => {
      expect(screen.getByTestId("webhook-secret-url")).toHaveTextContent(
        "https://chat.example.com/api/webhooks/wh1/awh_new",
      );
    });
  });

  it("deletes only after confirmation", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mutationFor("webhooks:remove")).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete webhook" }));
    await waitFor(() => {
      expect(mutationFor("webhooks:remove")).toHaveBeenCalledWith({ webhookId: "wh1" });
    });
  });
});
