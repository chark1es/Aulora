import { describe, expect, it } from "vitest";
import {
  downloadNotice,
  draftFromConfig,
  draftIsDirty,
  endpointProblem,
  isAlwaysRefusedHost,
  modelStatusLine,
  updateArgsFromDraft,
} from "./transcription-settings-model";

const config = {
  provider: "openai_compatible" as const,
  baseUrl: "https://llm.example.com/v1",
  model: "gpt-x",
  summaryLanguage: null,
  summaryStyle: "Concise",
  retentionDays: 30,
  allowPrivateEndpoint: false,
};

describe("transcription settings draft", () => {
  it("starts clean and never holds a key", () => {
    const draft = draftFromConfig(config);
    expect(draft.keyMode).toBe("keep");
    expect(draft.keyValue).toBe("");
    expect(draftIsDirty(draft, draftFromConfig(config))).toBe(false);
  });

  it("is dirty for any edit, a typed key, or a removal", () => {
    const baseline = draftFromConfig(config);
    expect(draftIsDirty({ ...baseline, model: "gpt-y" }, baseline)).toBe(true);
    expect(draftIsDirty({ ...baseline, keyMode: "replace", keyValue: "  " }, baseline)).toBe(false);
    expect(draftIsDirty({ ...baseline, keyMode: "replace", keyValue: "k" }, baseline)).toBe(true);
    expect(draftIsDirty({ ...baseline, keyMode: "clear" }, baseline)).toBe(true);
    expect(draftIsDirty({ ...baseline, allowPrivateEndpoint: true }, baseline)).toBe(true);
  });

  it("sends the key only when it is being replaced or removed", () => {
    const base = draftFromConfig(config);
    expect("apiKey" in updateArgsFromDraft(base)).toBe(false);
    expect(updateArgsFromDraft({ ...base, keyMode: "replace", keyValue: " sk-1 " }).apiKey).toBe(
      "sk-1",
    );
    expect(updateArgsFromDraft({ ...base, keyMode: "clear" }).apiKey).toBe("");
    // An empty replacement means "keep", never "clear".
    expect("apiKey" in updateArgsFromDraft({ ...base, keyMode: "replace", keyValue: "" })).toBe(
      false,
    );
  });

  it("pins OpenRouter's address and clamps retention", () => {
    const args = updateArgsFromDraft({
      ...draftFromConfig(config),
      provider: "openrouter",
      baseUrl: "https://elsewhere.example",
      retentionDays: "999999",
    });
    expect(args.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(args.retentionDays).toBe(3650);
  });
});

describe("endpointProblem", () => {
  const draft = draftFromConfig(config);
  it("accepts https and rejects blanks, junk and embedded credentials", () => {
    expect(endpointProblem(draft)).toBeNull();
    expect(endpointProblem({ ...draft, baseUrl: " " })).toMatch(/base URL/u);
    expect(endpointProblem({ ...draft, baseUrl: "not a url" })).toMatch(/full URL/u);
    expect(endpointProblem({ ...draft, baseUrl: "https://u:p@host/v1" })).toMatch(/API key field/u);
  });

  it("needs the private-network opt-in for plain http", () => {
    expect(endpointProblem({ ...draft, baseUrl: "http://192.168.1.20:11434/v1" })).toMatch(
      /https/u,
    );
    expect(
      endpointProblem({
        ...draft,
        baseUrl: "http://192.168.1.20:11434/v1",
        allowPrivateEndpoint: true,
      }),
    ).toBeNull();
    expect(
      endpointProblem({ ...draft, baseUrl: "ftp://host", allowPrivateEndpoint: true }),
    ).toMatch(/http or https/u);
  });
});

describe("modelStatusLine", () => {
  it("describes each state, with bounded progress", () => {
    expect(modelStatusLine({ status: "ready", progress: null, error: null }).label).toBe("Ready");
    expect(modelStatusLine({ status: "downloading", progress: 41.6, error: null })).toMatchObject({
      label: "Downloading… 42%",
      progress: 42,
    });
    expect(modelStatusLine({ status: "downloading", progress: 400, error: null }).progress).toBe(
      100,
    );
    expect(
      modelStatusLine({ status: "downloading", progress: null, error: null }).progress,
    ).toBeNull();
    expect(modelStatusLine({ status: "error", progress: null, error: "Disk full" }).detail).toBe(
      "Disk full",
    );
    expect(modelStatusLine({ status: "not_installed", progress: null, error: null }).label).toBe(
      "Not downloaded",
    );
  });
});

describe("model download progress", () => {
  it("is indeterminate while downloading with no percentage, never a fake 0%", () => {
    expect(modelStatusLine({ status: "downloading", progress: null, error: null })).toMatchObject({
      label: "Downloading…",
      progress: null,
      indeterminate: true,
    });
    expect(modelStatusLine({ status: "downloading", progress: 0, error: null })).toMatchObject({
      progress: 0,
      indeterminate: false,
    });
    expect(
      modelStatusLine({ status: "downloading", progress: 42, error: null }).indeterminate,
    ).toBe(false);
  });

  it("is only indeterminate while downloading", () => {
    for (const status of ["ready", "error", "not_installed"] as const) {
      expect(modelStatusLine({ status, progress: null, error: null }).indeterminate).toBe(false);
    }
  });

  it("turns a failed download of another model into a quiet notice", () => {
    expect(downloadNotice({ lastError: "Disk full", modelStatus: "ready" })).toBe(
      "The last model download failed: Disk full",
    );
    expect(downloadNotice({ lastError: null, modelStatus: "ready" })).toBeNull();
    expect(downloadNotice({ lastError: "  ", modelStatus: "ready" })).toBeNull();
    expect(downloadNotice({ lastError: undefined, modelStatus: "ready" })).toBeNull();
    // The model's own error row already says it.
    expect(downloadNotice({ lastError: "Disk full", modelStatus: "error" })).toBeNull();
  });
});

describe("isAlwaysRefusedHost", () => {
  it("refuses loopback, unspecified, link-local and metadata hosts", () => {
    for (const host of [
      "localhost",
      "api.localhost",
      "127.0.0.1",
      "127.8.9.10",
      "0.0.0.0",
      "169.254.169.254",
      "169.254.1.1",
      "[::1]",
      "::1",
      "fe80::1",
    ]) {
      expect(isAlwaysRefusedHost(host)).toBe(true);
    }
  });

  it("leaves private LAN addresses and public names to the opt-in and the server", () => {
    for (const host of [
      "192.168.1.20",
      "10.0.0.5",
      "172.16.0.9",
      "host.docker.internal",
      "llm.example.com",
      "8.8.8.8",
    ]) {
      expect(isAlwaysRefusedHost(host)).toBe(false);
    }
  });

  it("is reported by the form even with the private-network opt-in", () => {
    const base = draftFromConfig({ ...config, allowPrivateEndpoint: true });
    expect(endpointProblem({ ...base, baseUrl: "http://localhost:11434/v1" })).toMatch(
      /always refused/u,
    );
    expect(endpointProblem({ ...base, baseUrl: "http://169.254.169.254/latest" })).toMatch(
      /always refused/u,
    );
    expect(endpointProblem({ ...base, baseUrl: "http://192.168.1.20:11434/v1" })).toBeNull();
    expect(
      endpointProblem({ ...base, baseUrl: "http://host.docker.internal:11434/v1" }),
    ).toBeNull();
  });
});
