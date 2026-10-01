import type { SoundEvent } from "@aulora/core";
import { Icon, Switch, Text } from "@aulora/ui-web";
import { playSound, useSoundSettings } from "../../lib/sounds";

const EVENT_ROWS: readonly {
  readonly event: SoundEvent;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    event: "message",
    label: "Message received",
    description: "A cue when a new message arrives in a channel you follow.",
  },
  {
    event: "mention",
    label: "Mentioned",
    description: "A brighter cue when someone @mentions you.",
  },
  {
    event: "call-ring",
    label: "Incoming call",
    description: "Rings while a call is waiting for you to answer.",
  },
  { event: "call-connect", label: "Call connected", description: "Plays when you join a call." },
  {
    event: "call-join",
    label: "Someone joins a call",
    description: "A soft note when another person joins your call.",
  },
  {
    event: "call-leave",
    label: "Someone leaves a call",
    description: "A soft note when someone leaves your call.",
  },
];

/**
 * Notifications & sounds settings: a master switch, a 0–200% volume and a
 * per-event toggle for each cue. Cues are synthesized, so there is nothing to
 * download and previews play the real thing.
 */
export function NotificationsSettingsSection() {
  const [settings, update, updateEvent] = useSoundSettings();

  return (
    <section className="flex flex-col gap-4" aria-label="Notifications and sounds">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <Icon name="bell" size={17} />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-text">Notifications &amp; sounds</h3>
          <p className="text-[12px] text-text-muted">
            Subtle cues for messages, mentions and calls.
          </p>
        </div>
      </div>

      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={settings.enabled}
          onChange={(enabled) => update({ enabled })}
          label="Play sound cues"
          description="Turns every cue below on or off at once."
        />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-[12px] font-medium text-text-muted">
          Volume
          <span className="tabular-nums text-text-muted">{Math.round(settings.volume * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={settings.volume}
          disabled={!settings.enabled}
          onChange={(event) => update({ volume: Number(event.target.value) })}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent disabled:opacity-50"
        />
      </label>

      <ul className="overflow-hidden rounded-[10px] border border-border bg-surface-1">
        {EVENT_ROWS.map((row, index) => (
          <li key={row.event} className={index > 0 ? "border-t border-border" : undefined}>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-text">{row.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
                  {row.description}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Preview ${row.label}`}
                disabled={!settings.enabled}
                onClick={() => playSound(row.event, settings)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text disabled:opacity-40"
              >
                <Icon name="volume" size={15} />
              </button>
              <Switch
                bare
                checked={settings.events[row.event]}
                disabled={!settings.enabled}
                onChange={(value) => updateEvent({ [row.event]: value })}
                label={row.label}
              />
            </div>
          </li>
        ))}
      </ul>

      <Text tone="muted" size="xs">
        Sounds play on this device only. Volume is stored locally.
      </Text>
    </section>
  );
}
