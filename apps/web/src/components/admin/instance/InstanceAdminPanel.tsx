import { Button, Heading, Icon, IconButton, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { AdminPageHeader } from "../AdminPageHeader";
import { AuthSection } from "./AuthSection";
import { EmailSection } from "./EmailSettingsSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { BackupsSection, OverviewSection } from "./InstanceSections";
import { LicensePanel } from "./LicensePanel";
import { PushRelaySection } from "./PushRelaySection";
import { StorageSection } from "./StorageSection";

export interface InstanceAdminPanelProps {
  readonly canManage: boolean;
  /** Only used by the overlay variant's Close affordance. */
  readonly onClose?: () => void;
  /** `overlay` renders the fixed dialog; `inline` embeds in a settings page. */
  readonly variant?: "overlay" | "inline";
}

type TabId =
  | "overview"
  | "auth"
  | "environment"
  | "email"
  | "storage"
  | "backups"
  | "push"
  | "license";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "auth", label: "Auth providers" },
  { id: "environment", label: "Environment" },
  { id: "email", label: "Email" },
  { id: "storage", label: "Storage" },
  { id: "backups", label: "Backups" },
  { id: "push", label: "Push relay" },
  { id: "license", label: "License" },
];

/**
 * Instance admin console for the operator: auth provider status, storage
 * quotas, backups and push relay settings, plus the license status. Every write
 * is re-checked server-side against the workspace owner.
 *
 * Renders as the classic right-side overlay by default, or inline (the new
 * home inside workspace settings) when `variant="inline"`.
 */
export function InstanceAdminPanel({
  canManage,
  onClose,
  variant = "overlay",
}: InstanceAdminPanelProps) {
  if (variant === "inline") {
    return (
      <section
        className="flex flex-col gap-8"
        data-testid="instance-admin-panel"
        aria-label="Instance admin"
      >
        <AdminPageHeader
          title="Instance"
          description="Server status, auth providers, environment overrides, storage quotas, backups, push relay and licensing. Visible to the workspace owner only."
        />
        <InstanceAdminContent canManage={canManage} bodyClassName="flex flex-col gap-8" />
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-bg/70"
      data-testid="instance-admin-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Instance admin"
    >
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-surface-1">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <Heading level={2}>Instance admin</Heading>
          <IconButton
            label="Close instance admin"
            onClick={() => {
              onClose?.();
            }}
          >
            <Icon name="x" size={16} />
          </IconButton>
        </header>
        <InstanceAdminContent
          canManage={canManage}
          {...(onClose !== undefined ? { onClose } : {})}
          bodyClassName="min-h-0 flex-1 overflow-y-auto p-5"
        />
      </div>
    </div>
  );
}

function InstanceAdminContent({
  canManage,
  onClose,
  bodyClassName,
}: {
  readonly canManage: boolean;
  readonly onClose?: () => void;
  readonly bodyClassName: string;
}) {
  const overview = useQuery(api.instance.overview, canManage ? {} : "skip");
  const [active, setActive] = useState<TabId>("overview");

  return (
    <>
      <nav
        className="flex gap-1 overflow-x-auto border-b border-border pb-2"
        aria-label="Instance admin sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={active === tab.id ? "page" : undefined}
            data-testid={`instance-tab-${tab.id}`}
            className={
              active === tab.id
                ? "shrink-0 rounded-[7px] bg-surface-3 px-2.5 py-1 text-[12px] font-medium text-text"
                : "shrink-0 rounded-[7px] px-2.5 py-1 text-[12px] text-text-muted transition hover:bg-surface-2 hover:text-text"
            }
            onClick={() => {
              setActive(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className={bodyClassName}>
        {!canManage ? (
          <Text tone="muted" size="sm" data-testid="instance-admin-locked">
            Only the instance administrator can open this panel.
          </Text>
        ) : overview === undefined ? (
          <Text tone="muted" size="sm">
            Loading instance status…
          </Text>
        ) : (
          <>
            {active === "overview" && <OverviewSection overview={overview} />}
            {active === "auth" && <AuthSection overview={overview} />}
            {active === "environment" && <EnvironmentSection />}
            {active === "email" && <EmailSection />}
            {active === "storage" && <StorageSection overview={overview} />}
            {active === "backups" && <BackupsSection overview={overview} />}
            {active === "push" && <PushRelaySection overview={overview} />}
            {active === "license" && <LicensePanel canManage={canManage} />}
          </>
        )}
        {onClose !== undefined && (
          <div className="mt-6">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
