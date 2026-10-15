/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { SOUND_EVENTS, type SoundEvent, type SoundSettings } from "@aulora/core";
import { Button, SettingRow, Switch, Text } from "@aulora/ui-native";
import { ScrollView, View } from "react-native";
import { selectionFeedback } from "../../lib/haptics";
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
        <SettingRow
          label="Enable sounds"
          description="Play a cue for calls and messages"
          control={
            <Switch
              accessibilityLabel="Enable sounds"
              value={settings.enabled}
              onValueChange={(value) => {
                selectionFeedback();
                void updateSettings({ enabled: value });
              }}
            />
          }
        />
      </ListGroup>
    </View>
  );
}

function VolumeSection({ sound }: { readonly sound: SoundState }) {
  const { settings, updateSettings, available, play } = sound;
  return (
    <View>
      <ListHeader title="Volume" />
      <ListGroup inset={16}>
        <SettingRow
          label="Playback volume"
          control={
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
          }
        />
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

/** Sound cue preferences: a master switch, per-event switches and volume 0–200%. */
export function SoundSettingsSection() {
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
    <SettingRow
      label={label}
      control={
        <Switch
          accessibilityLabel={label}
          value={enabled}
          onValueChange={(value) => {
            selectionFeedback();
            onChange(value);
          }}
        />
      }
    />
  );
}
