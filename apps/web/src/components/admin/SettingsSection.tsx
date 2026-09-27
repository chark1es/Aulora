import type { IconName } from "@aulora/tokens";
import { Heading, Icon, Text } from "@aulora/ui-web";
import type { ReactNode } from "react";

/**
 * A consistent header for the settings sub-pages: a tinted glyph tile, the
 * section title and a one-line description. Keeps each group's first fold
 * visually aligned so navigating between them feels like one surface.
 */
export function SettingsSectionHeader({
  icon,
  title,
  description,
  trailing,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-accent-soft text-accent">
        <Icon name={icon} size={19} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Heading level={3}>{title}</Heading>
        <Text size="sm" tone="muted">
          {description}
        </Text>
      </div>
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </header>
  );
}
