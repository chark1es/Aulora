import { SOUND_EVENTS, type SoundEvent } from "@aulora/core";
import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { ScrollView, Switch, View } from "react-native";
import { useSound } from "../../providers/SoundProvider";

const EVENT_LABELS: Record<SoundEvent, string> = {
  message: "Messages",
  mention: "Mentions",
  "call-ring": "Incoming call ring",
  "call-connect": "Call connects",
  "call-join": "Someone joins",
  "call-leave": "Someone leaves",
};

/** Sound cue preferences: a master switch, per-event switches and volume 0–200%. */
export function SoundSettingsSection() {
  const palette = usePalette();
  const sound = useSound();
  if (sound === null) {
    return (
      <Text size="sm" tone="muted">
        Sound settings are unavailable.
      </Text>
    );
  }
  const { settings, updateSettings, available, play } = sound;

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <View className="flex-row items-center justify-between">
        <Text size="sm" className="flex-1">
          Enable sounds
        </Text>
        <Switch
          value={settings.enabled}
          onValueChange={(value) => void updateSettings({ enabled: value })}
          trackColor={{ false: palette.border, true: palette.accent }}
          thumbColor={palette["on-accent"]}
        />
      </View>

      <View className="gap-2">
        <Heading level={3}>Volume</Heading>
        <View className="flex-row items-center justify-between gap-3">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void updateSettings({ volume: Math.max(0, settings.volume - 0.1) })}
          >
            −
          </Button>
          <Text size="sm" mono style={{ minWidth: 60, textAlign: "center" }}>
            {`${Math.round(settings.volume * 100)}%`}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void updateSettings({ volume: Math.min(2, settings.volume + 0.1) })}
          >
            +
          </Button>
          <Button size="sm" variant="ghost" onPress={() => play("message")} disabled={!available}>
            Test
          </Button>
        </View>
      </View>

      <View className="gap-1">
        <Heading level={3}>Cues</Heading>
        {SOUND_EVENTS.map((event) => (
          <View key={event} className="flex-row items-center justify-between py-1">
            <Text size="sm" className="flex-1">
              {EVENT_LABELS[event]}
            </Text>
            <Switch
              value={settings.events[event]}
              onValueChange={(value) =>
                void updateSettings({ events: { ...settings.events, [event]: value } })
              }
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette["on-accent"]}
            />
          </View>
        ))}
      </View>

      {!available && (
        <Text size="xs" tone="muted">
          Audio playback needs the expo-audio native module; cues stay silent until it is built in.
        </Text>
      )}
    </ScrollView>
  );
}
