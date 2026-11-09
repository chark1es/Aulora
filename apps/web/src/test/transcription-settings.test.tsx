import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionSettings } from "../components/admin/TranscriptionSettings";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  actions: new Map<string, ReturnType<typeof vi.fn>>(),
}));

function mockFor(map: Map<string, ReturnType<typeof vi.fn>>, name: string) {
  if (!map.has(name)) {
    map.set(name, vi.fn().mockResolvedValue(undefined));
  }
  return map.get(name);
}

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    mockFor(state.mutations, getFunctionName(reference)),
  useAction: (reference: Parameters<typeof getFunctionName>[0]) =>
    mockFor(state.actions, getFunctionName(reference)),
}));

function config(overrides: Record<string, unknown> = {}) {
  return {
    modelId: "base",
    modelStatus: "not_installed",
    modelProgress: null,
    modelError: null,
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    hasApiKey: false,
    summaryLanguage: null,
    summaryStyle: null,
    retentionDays: 30,
    allowPrivateEndpoint: false,
    updatedAt: 1,
    availableModels: ["tiny", "base", "small", "medium", "large-v3-turbo"],
    serviceInstalled: true,
    ...overrides,
  };
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.actions.clear();
  state.values.set("transcription:getConfig", config());
});

describe("TranscriptionSettings", () => {
  it("shows a loading state until the config arrives", () => {
    state.values.clear();
    render(<TranscriptionSettings />);
    expect(screen.getByLabelText("Loading transcription settings")).toBeInTheDocument();
  });

  it("says plainly when the transcription service is not installed and blocks Download", () => {
    state.values.set("transcription:getConfig", config({ serviceInstalled: false }));
    render(<TranscriptionSettings />);
    expect(screen.getByText("Transcription service not installed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/u })).toBeDisabled();
  });

  it("downloads the chosen model and shows progress while it runs", async () => {
    const user = userEvent.setup();
    render(<TranscriptionSettings />);
    expect(screen.getByTestId("transcription-model-status")).toHaveTextContent("Not downloaded");
    await user.click(screen.getByRole("button", { name: /Download/u }));
    expect(state.mutations.get("transcription:downloadModel")).toHaveBeenCalledWith({
      modelId: "base",
    });
  });

  it("reports download progress, readiness and errors", () => {
    state.values.set(
      "transcription:getConfig",
      config({ modelStatus: "downloading", modelProgress: 41.6 }),
    );
    const { unmount } = render(<TranscriptionSettings />);
    expect(screen.getByRole("progressbar", { name: "Model download" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByRole("button", { name: /Download/u })).toBeDisabled();
    unmount();
    state.values.set("transcription:getConfig", config({ modelStatus: "ready" }));
    const ready = render(<TranscriptionSettings />);
    expect(screen.getByTestId("transcription-model-status")).toHaveTextContent("Ready");
    expect(screen.queryByRole("button", { name: /Download/u })).toBeNull();
    ready.unmount();
    state.values.set(
      "transcription:getConfig",
      config({ modelStatus: "error", modelError: "Disk full" }),
    );
    render(<TranscriptionSettings />);
    expect(screen.getByText("Disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("never shows a saved API key: only that one exists", () => {
    state.values.set("transcription:getConfig", config({ hasApiKey: true }));
    render(<TranscriptionSettings />);
    expect(screen.getByTestId("transcription-key-saved")).toHaveTextContent("A key is saved");
    // No input holds the key, and the field to type a new one is not on screen yet.
    expect(screen.queryByLabelText("API key")).toBeNull();
    for (const input of screen.queryAllByDisplayValue(/./u)) {
      expect((input as HTMLInputElement).type).not.toBe("password");
    }
  });

  it("types the key into a password field and sends it only on save, then forgets it", async () => {
    const user = userEvent.setup();
    state.values.set("transcription:getConfig", config({ hasApiKey: true }));
    render(<TranscriptionSettings />);
    await user.click(screen.getByRole("button", { name: "Replace" }));
    const key = screen.getByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "new-password");
    await user.type(key, "sk-secret-123");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const update = state.mutations.get("transcription:updateConfig");
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update?.mock.calls[0]?.[0]).toMatchObject({ apiKey: "sk-secret-123" });
    // After saving, the typed value is gone from the page.
    await waitFor(() => {
      expect(screen.queryByDisplayValue("sk-secret-123")).toBeNull();
    });
  });

  it("removes a saved key only when asked, and omits the key otherwise", async () => {
    const user = userEvent.setup();
    state.values.set("transcription:getConfig", config({ hasApiKey: true }));
    render(<TranscriptionSettings />);
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "gpt-x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const update = state.mutations.get("transcription:updateConfig");
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update?.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
    expect(update?.mock.calls[0]?.[0]).toMatchObject({ model: "gpt-x" });
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    expect(update?.mock.calls[1]?.[0]).toMatchObject({ apiKey: "" });
  });

  it("tests the connection with the unsaved form values and shows the outcome", async () => {
    const user = userEvent.setup();
    const test = vi.fn().mockResolvedValueOnce({ ok: true, model: "openai/gpt-4o-mini" });
    state.actions.set("transcriptionActions:testConnection", test);
    render(<TranscriptionSettings />);
    await user.type(screen.getByLabelText("API key"), "sk-try");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(test).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-try", allowPrivateEndpoint: false }),
    );
    expect(await screen.findByTestId("transcription-test-result")).toHaveTextContent(
      "Connected. Model: openai/gpt-4o-mini",
    );
    test.mockRejectedValueOnce(new Error("The summary endpoint timed out"));
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The summary endpoint timed out");
  });

  it("asks before allowing a private network endpoint, and warns while it is on", async () => {
    const user = userEvent.setup();
    state.values.set(
      "transcription:getConfig",
      config({ provider: "openai_compatible", baseUrl: "https://llm.example.com/v1" }),
    );
    render(<TranscriptionSettings />);
    const toggle = screen.getByRole("switch", { name: "Allow private network endpoint" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    // Not on yet: a confirmation comes first.
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(await screen.findByRole("button", { name: "Allow private network" }));
    expect(screen.getByRole("switch", { name: "Allow private network endpoint" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("note")).toHaveTextContent("Private network access is on");
  });

  it("refuses plain http unless private networks are allowed", async () => {
    const user = userEvent.setup();
    state.values.set(
      "transcription:getConfig",
      config({ provider: "openai_compatible", baseUrl: "https://llm.example.com/v1" }),
    );
    render(<TranscriptionSettings />);
    const base = screen.getByLabelText("Base URL");
    await user.clear(base);
    await user.type(base, "http://192.168.1.20:11434/v1");
    expect(screen.getByText(/Use https, or allow a private network endpoint/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("says loopback, link-local and metadata addresses are always refused, even with the opt-in", async () => {
    const user = userEvent.setup();
    state.values.set(
      "transcription:getConfig",
      config({
        provider: "openai_compatible",
        baseUrl: "http://localhost:11434/v1",
        allowPrivateEndpoint: true,
      }),
    );
    render(<TranscriptionSettings />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Loopback (localhost), link-local and cloud-metadata addresses are always refused, even with this on.",
    );
    const description = screen.getByText(/Lets summaries go to a private LAN address/u);
    expect(description).toHaveTextContent("192.168.x.x");
    expect(description).toHaveTextContent("host.docker.internal");
    // The opt-in does not make localhost work: the form refuses it.
    expect(screen.getByText(/always refused\. Use a private LAN address/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.queryByText(/local Ollama/u)).toBeNull();
    const base = screen.getByLabelText("Base URL");
    await user.clear(base);
    await user.type(base, "http://host.docker.internal:11434/v1");
    expect(screen.queryByText(/always refused\. Use a private LAN address/u)).toBeNull();
  });

  it("shows an indeterminate bar while downloading without a percentage, and a quiet notice for a failed earlier download", () => {
    state.values.set(
      "transcription:getConfig",
      config({ modelStatus: "downloading", modelProgress: null, modelError: "Disk full" }),
    );
    render(<TranscriptionSettings />);
    const bar = screen.getByRole("progressbar", { name: "Model download" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByTestId("transcription-model-status")).toHaveTextContent("Downloading…");
    expect(screen.getByTestId("transcription-model-status")).not.toHaveTextContent("%");
    expect(screen.getByText("The last model download failed: Disk full")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the numeric bar when the server does report a percentage", () => {
    state.values.set(
      "transcription:getConfig",
      config({ modelStatus: "downloading", modelProgress: 41 }),
    );
    render(<TranscriptionSettings />);
    expect(screen.getByRole("progressbar", { name: "Model download" })).toHaveAttribute(
      "aria-valuenow",
      "41",
    );
  });
});
