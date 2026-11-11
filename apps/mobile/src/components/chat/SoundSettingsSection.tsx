/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { SOUND_EVENTS, type SoundEvent, type SoundSettings } from "@aulora/core";
import { Button, SwitchRow, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { Component, type ReactNode, useState } from "react";
import { Alert, ScrollView, useWindowDimensions, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { selectionFeedback } from "../../lib/haptics";
import { useStuckTimeout } from "../../lib/stuck-timeout";
import { useOptionalChat } from "../../providers/ChatProvider";
import { useSound } from "../../providers/SoundProvider";
import { ListGroup, ListHeader } from "./List";

const EVENT_LABELS: Record<SoundEvent, string> = {
  message: "Messages",
  mention: "Mentions",
  "call-ring": "Incoming call ring",
  "call-connect": "Call connects",
  "call-join": "Someone joins",
  "call-leave": "Someone leaves",
};

function VolumeStepper({
  volume,
  updateVolume,
  playTest,
  available,
}: {
  readonly volume: number;
  readonly updateVolume: (_value: number) => void;
  readonly playTest: () => void;
  readonly available: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          updateVolume(Math.max(0, volume - 0.1));
        }}
      >
        −
      </Button>
      <Text size="sm" mono className="min-w-[48px] text-center">
        {`${Math.round(volume * 100)}%`}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          updateVolume(Math.min(2, volume + 0.1));
        }}
      >
        +
      </Button>
      <Button size="sm" variant="ghost" onPress={playTest} disabled={!available}>
        Test
      </Button>
    </View>
  );
}

type SoundState = NonNullable<ReturnType<typeof useSound>>;

function EnableSection({ sound }: { readonly sound: SoundState }) {
  const { settings, updateSettings } = sound;
  return (
    <View>
      <ListHeader title="Sounds" />
      <ListGroup inset={16}>
        <SwitchRow
          label="Enable sounds"
          description="Play a cue for calls and messages"
          value={settings.enabled}
          onValueChange={(value) => {
            selectionFeedback();
            void updateSettings({ enabled: value });
          }}
        />
      </ListGroup>
    </View>
  );
}

function VolumeSection({ sound }: { readonly sound: SoundState }) {
  const { settings, updateSettings, available, play } = sound;
  const stacked = useWindowDimensions().fontScale > 1.3;
  return (
    <View>
      <ListHeader title="Volume" />
      <ListGroup inset={16}>
        {/* At large text the stepper sits under the label instead of
            squeezing "Playback" into a mid-word break. */}
        <View
          className={
            stacked ? "gap-2 px-4 py-2.5" : "min-h-[52px] flex-row items-center gap-3 px-4 py-2.5"
          }
        >
          <Text className={stacked ? "font-medium" : "min-w-0 flex-1 font-medium"}>
            Playback volume
          </Text>
          <VolumeStepper
            volume={settings.volume}
            updateVolume={(value) => {
              void updateSettings({ volume: value });
            }}
            playTest={() => {
              play("message");
            }}
            available={available}
          />
        </View>
      </ListGroup>
    </View>
  );
}

function CuesSection({ sound }: { readonly sound: SoundState }) {
  const { settings, updateSettings } = sound;
  return (
    <View>
      <ListHeader title="Cues" />
      <ListGroup inset={16}>
        {SOUND_EVENTS.map((event) => (
          <SoundCueRow
            key={event}
            event={event}
            events={settings.events}
            onChange={(value) => {
              void updateSettings({ events: { ...settings.events, [event]: value } });
            }}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const MASS_MENTION_LABEL = "Don't notify me for @everyone and @here";

/** Shown instead of a dead switch when the notification preference cannot load. */
export function MassMentionUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      className="min-h-[52px] flex-row flex-wrap items-center gap-3 px-4 py-2.5"
    >
      <View className="min-w-0 flex-1 basis-48">
        <Text className="font-medium">{MASS_MENTION_LABEL}</Text>
        <Text size="xs" tone="danger">
          Couldn’t load this setting. Check your connection and try again.
        </Text>
      </View>
      <Button size="sm" variant="secondary" onPress={onRetry}>
        Try again
      </Button>
    </View>
  );
}

/** A query error in the preference row stays in the row, with its own retry. */
export class MassMentionBoundary extends Component<
  { readonly onRetry: () => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <MassMentionUnavailable onRetry={this.props.onRetry} />
    ) : (
      this.props.children
    );
  }
}

/** The server-wide mass-mention preference; a slow or failed load offers a retry. */
export function MassMentionToggle({
  attempt,
  onRetry,
}: {
  readonly attempt: number;
  readonly onRetry: () => void;
}) {
  const prefs = useQuery(api.notifications.getPrefs, {});
  const setPref = useMutation(api.notifications.setPref);
  const stuck = useStuckTimeout(prefs === undefined, attempt);
  if (prefs === undefined && stuck) return <MassMentionUnavailable onRetry={onRetry} />;
  const server = prefs?.find((row) => row.scope === "server");
  return (
    <SwitchRow
      label={MASS_MENTION_LABEL}
      description="Unread badges still count them."
      disabled={prefs === undefined}
      value={server?.suppressMassMentions === true}
      onValueChange={(value) => {
        selectionFeedback();
        void setPref({ scope: "server", suppressMassMentions: value }).catch(() => {
          Alert.alert("Couldn’t update notification settings", "Try again in a moment.");
        });
      }}
    />
  );
}

function BroadcastSettings() {
  const config = useQuery(api.server.publicConfig, {});
  // A new key remounts the row: a fresh subscription, boundary and countdown.
  const [attempt, setAttempt] = useState(0);
  if (!config?.capabilities?.mentionMarkers) return null;
  const retry = () => {
    setAttempt((current) => current + 1);
  };
  return (
    <MassMentionBoundary key={attempt} onRetry={retry}>
      <MassMentionToggle attempt={attempt} onRetry={retry} />
    </MassMentionBoundary>
  );
}

export function SoundSettingsSection() {
  // The server-wide preference needs a live server; the offline demo has none.
  const runtime = useOptionalChat()?.runtime;
  const sound = useSound();
  if (sound === null) {
    return (
      <Text size="sm" tone="muted">
        Sound settings are unavailable.
      </Text>
    );
  }
  const { available } = sound;

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
      {runtime !== undefined && <BroadcastSettings />}
      <EnableSection sound={sound} />
      <VolumeSection sound={sound} />
      <CuesSection sound={sound} />

      {!available && (
        <Text size="xs" tone="muted">
          Audio playback needs the expo-audio native module; cues stay silent until it is built in.
        </Text>
      )}
    </ScrollView>
  );
}

function SoundCueRow({
  event,
  events,
  onChange,
}: {
  readonly event: SoundEvent;
  readonly events: SoundSettings["events"];
  readonly onChange: (_value: boolean) => void;
}) {
  const { [event]: label } = EVENT_LABELS;
  const { [event]: enabled } = events;
  return (
    <SwitchRow
      label={label}
      value={enabled}
      onValueChange={(value) => {
        selectionFeedback();
        onChange(value);
      }}
    />
  );
}
