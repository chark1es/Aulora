import type { MediaDeviceInfo, VoiceDeviceSettings } from "@aulora/core";
import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useVoice } from "../../providers/VoiceProvider";

const RESOLUTIONS: readonly VoiceDeviceSettings["videoResolution"][] = ["360p", "720p", "1080p"];

/**
 * Voice and video device preferences: input/output/camera pickers, audio
 * processing switches, gains, video resolution and join defaults. Rendered
 * inside the members sheet's voice settings modal.
 */
export function DeviceSettingsSection() {
  const { settings, devices, updateSettings } = useVoice();

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
      <DevicePicker
        label="Microphone"
        kind="audioinput"
        devices={devices}
        selected={settings.inputDeviceId}
        onSelect={(deviceId) => void updateSettings({ inputDeviceId: deviceId })}
      />
      <DevicePicker
        label="Camera"
        kind="videoinput"
        devices={devices}
        selected={settings.cameraDeviceId}
        onSelect={(deviceId) => void updateSettings({ cameraDeviceId: deviceId })}
      />
      <DevicePicker
        label="Speaker"
        kind="audiooutput"
        devices={devices}
        selected={settings.outputDeviceId}
        onSelect={(deviceId) => void updateSettings({ outputDeviceId: deviceId })}
      />

      <View className="gap-1">
        <Heading level={3} className="text-base">
          Audio processing
        </Heading>
        <ToggleRow
          label="Echo cancellation"
          value={settings.echoCancellation}
          onChange={(value) => void updateSettings({ echoCancellation: value })}
        />
        <ToggleRow
          label="Noise suppression"
          value={settings.noiseSuppression}
          onChange={(value) => void updateSettings({ noiseSuppression: value })}
        />
        <ToggleRow
          label="Automatic gain control"
          value={settings.autoGainControl}
          onChange={(value) => void updateSettings({ autoGainControl: value })}
        />
      </View>

      <View className="gap-2">
        <Heading level={3} className="text-base">
          Levels
        </Heading>
        <VolumeStepper
          label="Input volume"
          value={settings.inputVolume}
          onChange={(value) => void updateSettings({ inputVolume: value })}
        />
        <VolumeStepper
          label="Output volume"
          value={settings.outputVolume}
          onChange={(value) => void updateSettings({ outputVolume: value })}
        />
      </View>

      <View className="gap-2">
        <Heading level={3} className="text-base">
          Video
        </Heading>
        <Segmented
          label="Resolution"
          options={RESOLUTIONS}
          value={settings.videoResolution}
          onSelect={(value) => void updateSettings({ videoResolution: value })}
        />
        <ToggleRow
          label="Mirror camera"
          value={settings.mirrorCamera}
          onChange={(value) => void updateSettings({ mirrorCamera: value })}
        />
      </View>

      <View className="gap-1">
        <Heading level={3} className="text-base">
          When joining
        </Heading>
        <ToggleRow
          label="Push to talk"
          value={settings.pushToTalk}
          onChange={(value) => void updateSettings({ pushToTalk: value })}
        />
        <ToggleRow
          label="Join muted"
          value={settings.joinMuted}
          onChange={(value) => void updateSettings({ joinMuted: value })}
        />
        <ToggleRow
          label="Join with camera on"
          value={settings.joinWithCamera}
          onChange={(value) => void updateSettings({ joinWithCamera: value })}
        />
      </View>
    </ScrollView>
  );
}

function DevicePicker({
  label,
  kind,
  devices,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly kind: MediaDeviceInfo["kind"];
  readonly devices: readonly MediaDeviceInfo[];
  readonly selected: string | null;
  readonly onSelect: (deviceId: string | null) => void;
}) {
  const palette = usePalette();
  const options = devices.filter((device) => device.kind === kind);
  return (
    <View className="gap-1.5">
      <Heading level={3} className="text-base">
        {label}
      </Heading>
      <DeviceOption
        label="System default"
        selected={selected === null}
        onPress={() => onSelect(null)}
      />
      {options.map((device) => (
        <DeviceOption
          key={device.deviceId}
          label={device.label}
          selected={selected === device.deviceId}
          onPress={() => onSelect(device.deviceId)}
          checkColor={palette.accent}
        />
      ))}
      {options.length === 0 && (
        <Text size="xs" tone="muted">
          No devices detected yet.
        </Text>
      )}
    </View>
  );
}

function DeviceOption({
  label,
  selected,
  onPress,
  checkColor,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly checkColor?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={
        selected
          ? "flex-row items-center justify-between rounded-input border border-accent bg-accent-soft px-3 py-2"
          : "flex-row items-center justify-between rounded-input border border-border bg-surface-3 px-3 py-2"
      }
    >
      <Text size="sm" numberOfLines={1} className="flex-1">
        {label}
      </Text>
      {selected && (
        <Text
          size="sm"
          tone="accent"
          style={checkColor !== undefined ? { color: checkColor } : undefined}
        >
          ✓
        </Text>
      )}
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text size="sm" className="flex-1">
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.border, true: palette.accent }}
        thumbColor={palette["on-accent"]}
      />
    </View>
  );
}

function VolumeStepper({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const step = 0.1;
  const clamp = (next: number) => Math.min(2, Math.max(0, Math.round(next * 10) / 10));
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text size="sm" className="flex-1">
        {label}
      </Text>
      <Button size="sm" variant="secondary" onPress={() => onChange(clamp(value - step))}>
        −
      </Button>
      <Text size="sm" mono style={{ minWidth: 48, textAlign: "center" }}>
        {`${Math.round(value * 100)}%`}
      </Text>
      <Button size="sm" variant="secondary" onPress={() => onChange(clamp(value + step))}>
        +
      </Button>
    </View>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly onSelect: (value: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text size="sm">{label}</Text>
      <View className="flex-row gap-2">
        {options.map((option) => {
          const active = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(option)}
              className={
                active
                  ? "flex-1 items-center rounded-input border border-accent bg-accent-soft px-3 py-2"
                  : "flex-1 items-center rounded-input border border-border bg-surface-3 px-3 py-2"
              }
            >
              <Text size="sm" tone={active ? "accent" : "muted"}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
