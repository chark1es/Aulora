import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type EnvironmentSectionModel,
  EnvironmentSectionView,
} from "../components/admin/instance/EnvironmentSection";
import { EnvVariableRow } from "../components/admin/instance/EnvVariableRow";
import type { EnvVariable, EnvVariablesModel } from "../lib/instance-env";

type EnvVariableOverrides = Partial<EnvVariable> & { readonly key: string };

function variable(overrides: EnvVariableOverrides): EnvVariable {
  const base: EnvVariable = {
    key: overrides.key,
    group: "oidc",
    label: "Label",
    description: "Description",
    type: "string",
    enumValues: null,
    secret: false,
    overridable: true,
    managedInSection: null,
    source: "environment",
    isSet: true,
  };
  return Object.assign(base, overrides);
}

function buildModel(overrides: Partial<EnvVariablesModel> = {}): EnvironmentSectionModel {
  const data: EnvVariablesModel = {
    locked: false,
    encryptionConfigured: true,
    groups: [
      { id: "auth-providers", label: "Auth providers" },
      { id: "oidc", label: "Single sign-on (OIDC)" },
    ],
    variables: [
      variable({ key: "GITHUB_CLIENT_ID", group: "auth-providers", label: "GitHub client id" }),
      variable({
        key: "GITHUB_CLIENT_SECRET",
        group: "auth-providers",
        label: "GitHub client secret",
        secret: true,
      }),
      variable({
        key: "OIDC_CLIENT_ID",
        group: "oidc",
        label: "OIDC client id",
        source: "unset",
        isSet: false,
      }),
    ],
    ...overrides,
  };
  return {
    data,
    save: vi.fn(async () => null),
    saveMany: vi.fn(async () => null),
    reset: vi.fn(async () => null),
  };
}

describe("EnvironmentSectionView", () => {
  it("shows provenance without any deployment value", async () => {
    const user = userEvent.setup();
    render(<EnvironmentSectionView model={buildModel()} />);
    expect(screen.getByTestId("env-source-GITHUB_CLIENT_ID")).toHaveTextContent("Deployment");
    expect(screen.getByTestId("env-value-GITHUB_CLIENT_ID")).toHaveTextContent(
      "Set by the deployment (value hidden)",
    );

    await user.click(screen.getByTestId("env-group-tab-oidc"));
    expect(screen.getByTestId("env-value-OIDC_CLIENT_ID")).toHaveTextContent("Not set");
    expect(screen.queryByTestId("env-reset-OIDC_CLIENT_ID")).not.toBeInTheDocument();
  });

  it("shows one group at a time unless searching", async () => {
    const user = userEvent.setup();
    render(<EnvironmentSectionView model={buildModel()} />);
    expect(screen.getByTestId("env-var-GITHUB_CLIENT_ID")).toBeInTheDocument();
    expect(screen.queryByTestId("env-var-OIDC_CLIENT_ID")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter variables"), "oidc");
    expect(screen.queryByTestId("env-var-GITHUB_CLIENT_ID")).not.toBeInTheDocument();
    expect(screen.getByTestId("env-var-OIDC_CLIENT_ID")).toBeInTheDocument();

    await user.click(screen.getByTestId("env-filter-clear"));
    expect(screen.getByTestId("env-result-count")).toHaveTextContent("2 variables");
  });

  it("filters by override state", async () => {
    const user = userEvent.setup();
    const model = buildModel({
      variables: [
        variable({ key: "GITHUB_CLIENT_ID", group: "auth-providers" }),
        variable({ key: "SITE_URL", group: "auth-providers", overridable: false }),
      ],
    });
    render(<EnvironmentSectionView model={model} />);
    await user.click(screen.getByRole("button", { name: "Overridable" }));
    expect(screen.getByTestId("env-var-GITHUB_CLIENT_ID")).toBeInTheDocument();
    expect(screen.queryByTestId("env-var-SITE_URL")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Read-only" }));
    expect(screen.getByTestId("env-var-SITE_URL")).toBeInTheDocument();
    expect(screen.queryByTestId("env-var-GITHUB_CLIENT_ID")).not.toBeInTheDocument();
  });

  it("locks the section when the kill switch is set", () => {
    render(<EnvironmentSectionView model={buildModel({ locked: true })} />);
    expect(screen.getByTestId("env-locked")).toHaveTextContent(
      "AULORA_ALLOW_UI_ENV_OVERRIDES=false",
    );
    for (const button of screen.getAllByRole("button", { name: "Override" })) {
      expect(button).toBeDisabled();
    }
  });

  it("blocks storing when encryption is not configured", () => {
    render(<EnvironmentSectionView model={buildModel({ encryptionConfigured: false })} />);
    expect(screen.getByTestId("env-encryption-missing")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Override" })[0]).toBeDisabled();
  });
});

describe("EnvVariableRow", () => {
  it("keeps secrets write-only and saves inline", async () => {
    const onSave = vi.fn(async () => null);
    const user = userEvent.setup();
    render(
      <EnvVariableRow
        variable={variable({
          key: "OIDC_CLIENT_SECRET",
          label: "OIDC client secret",
          secret: true,
          source: "unset",
          isSet: false,
        })}
        locked={false}
        encryptionReady
        onSave={onSave}
        onReset={vi.fn(async () => null)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Override" }));
    const input = screen.getByLabelText("OIDC client secret");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "Enter the secret");

    await user.type(input, "super-secret-value");
    await user.click(screen.getByTestId("env-save-OIDC_CLIENT_SECRET"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("super-secret-value");
    });
  });

  it("keeps an existing secret when saved blank", async () => {
    const onSave = vi.fn(async () => null);
    const user = userEvent.setup();
    render(
      <EnvVariableRow
        variable={variable({
          key: "GITHUB_CLIENT_SECRET",
          label: "GitHub client secret",
          secret: true,
          source: "ui",
        })}
        locked={false}
        encryptionReady
        onSave={onSave}
        onReset={vi.fn(async () => null)}
      />,
    );
    expect(screen.getByTestId("env-value-GITHUB_CLIENT_SECRET")).toHaveTextContent("••••••");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("env-save-GITHUB_CLIENT_SECRET"));
    await waitFor(() => {
      expect(screen.queryByTestId("env-form-GITHUB_CLIENT_SECRET")).not.toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("resets through a confirmation and reports results", async () => {
    const onReset = vi.fn(async () => null);
    const user = userEvent.setup();
    render(
      <EnvVariableRow
        variable={variable({
          key: "OIDC_CLIENT_ID",
          label: "OIDC client id",
          source: "ui",
          value: "ui-client",
        })}
        locked={false}
        encryptionReady
        onSave={vi.fn(async () => null)}
        onReset={onReset}
      />,
    );
    expect(screen.getByTestId("env-value-OIDC_CLIENT_ID")).toHaveTextContent("ui-client");
    await user.click(screen.getByTestId("env-reset-OIDC_CLIENT_ID"));
    await user.click(screen.getByRole("button", { name: "Reset to environment" }));
    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Reset to the environment value.")).toBeInTheDocument();
  });
});

describe("EnvVariableRow editors", () => {
  it("uses a switch for booleans", async () => {
    const onSave = vi.fn(async () => null);
    const user = userEvent.setup();
    render(
      <EnvVariableRow
        variable={variable({
          key: "AUTH_LOCAL_ENABLED",
          label: "Local sign-in enabled",
          type: "boolean",
          source: "unset",
          isSet: false,
        })}
        locked={false}
        encryptionReady
        onSave={onSave}
        onReset={vi.fn(async () => null)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Override" }));
    await user.click(screen.getByRole("switch", { name: "Local sign-in enabled" }));
    await user.click(screen.getByTestId("env-save-AUTH_LOCAL_ENABLED"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("true");
    });
  });

  it("edits lists as removable chips", async () => {
    const onSave = vi.fn(async () => null);
    const user = userEvent.setup();
    render(
      <EnvVariableRow
        variable={variable({
          key: "OIDC_SCOPES",
          label: "OIDC scopes",
          type: "list",
          source: "unset",
          isSet: false,
        })}
        locked={false}
        encryptionReady
        onSave={onSave}
        onReset={vi.fn(async () => null)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Override" }));
    await user.type(screen.getByLabelText("Add a value to OIDC scopes"), "openid{Enter}");
    await user.click(screen.getByTestId("env-save-OIDC_SCOPES"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("openid");
    });
  });
});

function oidcVariables(): EnvVariable[] {
  return [
    variable({ key: "OIDC_ISSUER", label: "OIDC issuer", source: "unset", isSet: false }),
    variable({
      key: "OIDC_DISCOVERY_URL",
      label: "OIDC discovery URL",
      source: "unset",
      isSet: false,
    }),
    variable({ key: "OIDC_CLIENT_ID", label: "OIDC client id", source: "unset", isSet: false }),
    variable({
      key: "OIDC_CLIENT_SECRET",
      label: "OIDC client secret",
      secret: true,
      source: "unset",
      isSet: false,
    }),
  ];
}

describe("OIDC provider form", () => {
  it("validates the discovery URL client-side", async () => {
    const model = buildModel({ variables: oidcVariables() });
    const user = userEvent.setup();
    render(<EnvironmentSectionView model={model} />);

    await user.click(screen.getByTestId("env-add-oidc"));
    await user.type(screen.getByLabelText("Issuer"), "https://ui-idp.example");
    await user.type(screen.getByLabelText("Discovery URL"), "https://ui-idp.example/");
    await user.type(screen.getByLabelText("Client id"), "ui-client");
    await user.type(screen.getByLabelText("Client secret"), "ui-secret");
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("openid-configuration");
    expect(model.saveMany).not.toHaveBeenCalled();
  });

  it("saves the whole group after confirmation", async () => {
    const model = buildModel({ variables: oidcVariables() });
    const user = userEvent.setup();
    render(<EnvironmentSectionView model={model} />);

    await user.click(screen.getByTestId("env-add-oidc"));
    await user.type(screen.getByLabelText("Issuer"), "https://ui-idp.example");
    await user.type(
      screen.getByLabelText("Discovery URL"),
      "https://ui-idp.example/.well-known/openid-configuration",
    );
    await user.type(screen.getByLabelText("Client id"), "ui-client");
    await user.type(screen.getByLabelText("Client secret"), "ui-secret");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByTestId("oidc-save"));

    await waitFor(() => {
      expect(model.saveMany).toHaveBeenCalledTimes(1);
    });
    const entries = vi.mocked(model.saveMany).mock.calls[0]?.[0];
    expect(entries).toEqual(
      expect.arrayContaining([
        { key: "OIDC_ISSUER", value: "https://ui-idp.example" },
        {
          key: "OIDC_DISCOVERY_URL",
          value: "https://ui-idp.example/.well-known/openid-configuration",
        },
        { key: "OIDC_CLIENT_ID", value: "ui-client" },
        { key: "OIDC_CLIENT_SECRET", value: "ui-secret" },
      ]),
    );
  });
});
