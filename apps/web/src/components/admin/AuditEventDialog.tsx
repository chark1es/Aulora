import { Button, Icon, Modal, Text } from "@aulora/ui-web";
import {
  type AuditDetailField,
  auditActionLabel,
  auditActorLabel,
  auditCategory,
  auditEventFields,
  auditTargetKind,
  formatAuditEvent,
  shortId,
} from "../../lib/audit-format";
import { AUDIT_CATEGORY_ICON } from "./audit-icons";

/** One row from the paginated audit-log query. */
export interface AuditEventView {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: string;
  readonly targetId: string | null;
  readonly targetName: string;
  readonly meta: string | null;
  readonly at: number;
}

export interface AuditEventDialogProps {
  readonly event: AuditEventView | null;
  readonly memberNames?: ReadonlyMap<string, string>;
  readonly roleNames?: ReadonlyMap<string, string>;
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly onClose: () => void;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value !== undefined && value !== null && value.length > 0) {
      return value;
    }
  }
  return null;
}

function resolveTarget(
  event: AuditEventView,
  memberNames: ReadonlyMap<string, string> | undefined,
  roleNames: ReadonlyMap<string, string> | undefined,
  channelNames: ReadonlyMap<string, string> | undefined,
): string | null {
  if (event.targetId === null) {
    return null;
  }
  return firstNonEmpty(
    event.targetName,
    memberNames?.get(event.targetId),
    roleNames?.get(event.targetId),
    channelNames?.get(event.targetId),
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <Text as="dt" size="sm" tone="muted">
        {label}
      </Text>
      <Text as="dd" size="sm" className="break-words">
        {value}
      </Text>
    </>
  );
}

interface AuditEventContentProps {
  readonly event: AuditEventView;
  readonly summary: string;
  readonly actor: string;
  readonly targetText: string;
  readonly when: string;
  readonly fields: readonly AuditDetailField[];
}

function AuditEventContent({
  event,
  summary,
  actor,
  targetText,
  when,
  fields,
}: AuditEventContentProps) {
  return (
    <div className="flex flex-col gap-5 pb-2" data-testid="audit-detail">
      <Text size="sm" className="leading-relaxed">
        {summary}
      </Text>

      <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-2.5">
        <DetailRow label="Action" value={capitalize(auditActionLabel(event.action))} />
        <DetailRow label="Actor" value={actor} />
        <DetailRow label="Target" value={targetText} />
        <DetailRow label="When" value={when} />
      </dl>

      {fields.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
          <Text size="xs" tone="muted" className="font-medium uppercase tracking-[0.08em]">
            Details
          </Text>
          <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-4 gap-y-2.5">
            {fields.map((field) => (
              <DetailRow
                key={`${field.label}-${field.value}`}
                label={field.label}
                value={field.value}
              />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

/**
 * A focused read-out of one audit event: who did what, to what, when, and the
 * action-specific metadata (provider toggles, invite settings, changed fields)
 * in a form that never shows raw JSON.
 */
interface AuditEventSummary {
  readonly actor: string;
  readonly targetText: string;
  readonly summary: string;
  readonly fields: readonly AuditDetailField[];
  readonly when: string;
}

function describeEvent(
  event: AuditEventView,
  memberNames: ReadonlyMap<string, string> | undefined,
  roleNames: ReadonlyMap<string, string> | undefined,
  channelNames: ReadonlyMap<string, string> | undefined,
): AuditEventSummary {
  const actor = auditActorLabel(event.actorName, event.actorId);
  const target = resolveTarget(event, memberNames, roleNames, channelNames);
  const lookups = {
    ...(memberNames !== undefined ? { memberNames } : {}),
    ...(roleNames !== undefined ? { roleNames } : {}),
    ...(channelNames !== undefined ? { channelNames } : {}),
  };
  const targetText =
    target ??
    (event.targetId === null
      ? "Not applicable"
      : `${auditTargetKind(event.action) ?? "Item"} (${shortId(event.targetId)})`);
  return {
    actor,
    targetText,
    summary: formatAuditEvent(event.action, event.meta, {
      actorName: actor,
      targetName: target,
      ...lookups,
    }),
    fields: auditEventFields(event.action, event.meta, lookups),
    when: new Date(event.at).toLocaleString(),
  };
}

/**
 * A focused read-out of one audit event: who did what, to what, when, and the
 * action-specific metadata (provider toggles, invite settings, changed fields)
 * in a form that never shows raw JSON.
 */
export function AuditEventDialog({
  event,
  memberNames,
  roleNames,
  channelNames,
  onClose,
}: AuditEventDialogProps) {
  if (event === null) {
    return null;
  }
  const detail = describeEvent(event, memberNames, roleNames, channelNames);

  return (
    <Modal
      open
      onClose={onClose}
      label="Audit event"
      title="Audit event"
      description={detail.when}
      icon={
        <Icon name={AUDIT_CATEGORY_ICON.get(auditCategory(event.action)) ?? "file"} size={18} />
      }
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <AuditEventContent event={event} {...detail} />
    </Modal>
  );
}
