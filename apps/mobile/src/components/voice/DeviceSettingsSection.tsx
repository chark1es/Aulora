import type { MediaDeviceInfo, VoiceDeviceSettings } from "@aulora/core";
import {
  Button,
  Icon,
  SegmentedControl,
  SettingRow,
  Switch,
  Text,
  usePalette,
} from "@aulora/ui-native";
import { ScrollView, View } from "react-native";
import { selectionFeedback } from "../../lib/haptics";
import { useVoice } from "../../providers/VoiceProvider";
import { ListGroup, ListHeader, ListRow } from "../chat/List";

const RESOLUTIONS: readonly VoiceDeviceSettings["videoResolution"][] = ["360p", "720p", "1080p"];
const RESOLUTION_OPTIONS = RESOLUTIONS.map((value) => ({ value, label: value }));

type UpdateSettings = (patch: Partial<VoiceDeviceSettings>) => void;

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
  const select = (deviceId: string | null) => {
    selectionFeedback();
    onSelect(deviceId);
  };
  const check = <Icon name="check" size={18} color={palette.accent} />;
  return (
    <View>
      <ListHeader title={label} />
      <ListGroup inset={16}>
        <ListRow
          title="System default"
          selected={selected === null}
          trailing={selected === null ? check : undefined}
          onPress={() => {
            select(null);
          }}
        />
        {options.map((device) => (
          <ListRow
            key={device.deviceId}
            title={device.label}
            selected={selected === device.deviceId}
            trailing={selected === device.deviceId ? check : undefined}
            onPress={() => {
              select(device.deviceId);
            }}
          />
        ))}
      </ListGroup>
      {options.length === 0 && (
        <Text size="xs" tone="muted" className="px-1 pt-1.5">
          No devices detected yet.
        </Text>
      )}
    </View>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value: boolean;
  readonly onChange: (_value: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Switch
          accessibilityLabel={label}
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            selectionFeedback();
            onChange(next);
          }}
        />
      }
    />
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
    <SettingRow
      label={label}
      control={
        <View className="flex-row items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              onChange(clamp(value - step));
            }}
          >
            −
          </Button>
          <Text size="sm" mono className="min-w-[48px] text-center">
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
      }
    />
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
    <View>
      <ListHeader title="Audio processing" />
      <ListGroup inset={16}>
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
      </ListGroup>
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
    <View>
      <ListHeader title="Levels" />
      <ListGroup inset={16}>
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
      </ListGroup>
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
    <View>
      <ListHeader title="Video" />
      <View className="pb-3">
        <SegmentedControl
          label="Resolution"
          options={RESOLUTION_OPTIONS}
          value={settings.videoResolution}
          onChange={(value) => {
            selectionFeedback();
            update({ videoResolution: value });
          }}
        />
      </View>
      <ListGroup inset={16}>
        <ToggleRow
          label="Mirror camera"
          value={settings.mirrorCamera}
          onChange={(value) => {
            update({ mirrorCamera: value });
          }}
        />
      </ListGroup>
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
    <View>
      <ListHeader title="When joining" />
      <ListGroup inset={16}>
        <ToggleRow
          label="Push to talk"
          value={settings.pushToTalk}
          onChange={(value) => {
            update({ pushToTalk: value });
          }}
          disabled={pushToTalkUnavailable && !settings.pushToTalk}
        />
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
      </ListGroup>
      {pushToTalkUnavailable && (
        <Text size="xs" tone="muted" className="px-1 pt-1.5">
          Push-to-talk needs live microphone levels, which this device’s WebRTC build does not
          expose. While it is enabled the microphone stays closed instead of transmitting.
        </Text>
      )}
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
