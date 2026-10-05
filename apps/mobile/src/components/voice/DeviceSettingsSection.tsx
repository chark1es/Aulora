import type { MediaDeviceInfo, VoiceDeviceSettings } from "@aulora/core";
import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useVoice } from "../../providers/VoiceProvider";

const RESOLUTIONS: readonly VoiceDeviceSettings["videoResolution"][] = ["360p", "720p", "1080p"];

type UpdateSettings = (patch: Partial<VoiceDeviceSettings>) => void;

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
  readonly onSelect: (_deviceId: string | null) => void;
}) {
  const palette = usePalette();
  const options = devices.filter((device) => device.kind === kind);
  return (
    <View className="gap-1.5">
      <Heading level={3}>{label}</Heading>
      <DeviceOption
        label="System default"
        selected={selected === null}
        onPress={() => {
          onSelect(null);
        }}
      />
      {options.map((device) => (
        <DeviceOption
          key={device.deviceId}
          label={device.label}
          selected={selected === device.deviceId}
          onPress={() => {
            onSelect(device.deviceId);
          }}
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

function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (_value: boolean) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text size="sm" className="flex-1" tone={disabled ? "muted" : "default"}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
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
  readonly onChange: (_value: number) => void;
}) {
  const step = 0.1;
  const clamp = (next: number) => Math.min(2, Math.max(0, Math.round(next * 10) / 10));
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text size="sm" className="flex-1">
        {label}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          onChange(clamp(value - step));
        }}
      >
        −
      </Button>
      <Text size="sm" mono style={{ minWidth: 48, textAlign: "center" }}>
        {`${Math.round(value * 100)}%`}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          onChange(clamp(value + step));
        }}
      >
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
  readonly onSelect: (_value: T) => void;
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
              onPress={() => {
                onSelect(option);
              }}
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

function AudioProcessing({
  settings,
  update,
}: {
  readonly settings: VoiceDeviceSettings;
  readonly update: UpdateSettings;
}) {
  return (
    <View className="gap-1">
      <Heading level={3}>Audio processing</Heading>
      <ToggleRow
        label="Echo cancellation"
        value={settings.echoCancellation}
        onChange={(value) => {
          update({ echoCancellation: value });
        }}
      />
      <ToggleRow
        label="Noise suppression"
        value={settings.noiseSuppression}
        onChange={(value) => {
          update({ noiseSuppression: value });
        }}
      />
      <ToggleRow
        label="Automatic gain control"
        value={settings.autoGainControl}
        onChange={(value) => {
          update({ autoGainControl: value });
        }}
      />
    </View>
  );
}

function LevelsSection({
  settings,
  update,
}: {
  readonly settings: VoiceDeviceSettings;
  readonly update: UpdateSettings;
}) {
  return (
    <View className="gap-2">
      <Heading level={3}>Levels</Heading>
      <VolumeStepper
        label="Input volume"
        value={settings.inputVolume}
        onChange={(value) => {
          update({ inputVolume: value });
        }}
      />
      <VolumeStepper
        label="Output volume"
        value={settings.outputVolume}
        onChange={(value) => {
          update({ outputVolume: value });
        }}
      />
      <VolumeStepper
        label="Noise gate"
        value={settings.noiseGateThreshold}
        onChange={(value) => {
          update({ noiseGateThreshold: value });
        }}
      />
    </View>
  );
}

function VideoSection({
  settings,
  update,
}: {
  readonly settings: VoiceDeviceSettings;
  readonly update: UpdateSettings;
}) {
  return (
    <View className="gap-2">
      <Heading level={3}>Video</Heading>
      <Segmented
        label="Resolution"
        options={RESOLUTIONS}
        value={settings.videoResolution}
        onSelect={(value) => {
          update({ videoResolution: value });
        }}
      />
      <ToggleRow
        label="Mirror camera"
        value={settings.mirrorCamera}
        onChange={(value) => {
          update({ mirrorCamera: value });
        }}
      />
    </View>
  );
}

function JoinSection({
  settings,
  update,
  pushToTalkUnavailable,
}: {
  readonly settings: VoiceDeviceSettings;
  readonly update: UpdateSettings;
  readonly pushToTalkUnavailable: boolean;
}) {
  return (
    <View className="gap-1">
      <Heading level={3}>When joining</Heading>
      <ToggleRow
        label="Push to talk"
        value={settings.pushToTalk}
        onChange={(value) => {
          update({ pushToTalk: value });
        }}
        disabled={pushToTalkUnavailable && !settings.pushToTalk}
      />
      {pushToTalkUnavailable && (
        <Text size="xs" tone="muted">
          Push-to-talk needs live microphone levels, which this device's WebRTC build does not
          expose. While it is enabled the microphone stays closed instead of transmitting.
        </Text>
      )}
      <ToggleRow
        label="Join muted"
        value={settings.joinMuted}
        onChange={(value) => {
          update({ joinMuted: value });
        }}
      />
      <ToggleRow
        label="Join with camera on"
        value={settings.joinWithCamera}
        onChange={(value) => {
          update({ joinWithCamera: value });
        }}
      />
    </View>
  );
}

/**
 * Voice and video device preferences: input/output/camera pickers, audio
 * processing switches, gains, video resolution and join defaults. Rendered
 * inside the members sheet's voice settings modal.
 */
export function DeviceSettingsSection() {
  const { settings, devices, updateSettings, micLevelAvailable, callId } = useVoice();
  const pushToTalkUnavailable = callId !== null && !micLevelAvailable;
  const update: UpdateSettings = (patch) => {
    void updateSettings(patch);
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
      <DevicePicker
        label="Microphone"
        kind="audioinput"
        devices={devices}
        selected={settings.inputDeviceId}
        onSelect={(deviceId) => {
          update({ inputDeviceId: deviceId });
        }}
      />
      <DevicePicker
        label="Camera"
        kind="videoinput"
        devices={devices}
        selected={settings.cameraDeviceId}
        onSelect={(deviceId) => {
          update({ cameraDeviceId: deviceId });
        }}
      />
      <DevicePicker
        label="Speaker"
        kind="audiooutput"
        devices={devices}
        selected={settings.outputDeviceId}
        onSelect={(deviceId) => {
          update({ outputDeviceId: deviceId });
        }}
      />
      <AudioProcessing settings={settings} update={update} />
      <LevelsSection settings={settings} update={update} />
      <VideoSection settings={settings} update={update} />
      <JoinSection
        settings={settings}
        update={update}
        pushToTalkUnavailable={pushToTalkUnavailable}
      />
    </ScrollView>
  );
}
