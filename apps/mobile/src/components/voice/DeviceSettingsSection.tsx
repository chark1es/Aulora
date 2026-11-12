import type { MediaDeviceInfo, VoiceDeviceSettings } from "@aulora/core";
import { Button, SegmentedControl, SettingRow, SwitchRow, Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { selectionFeedback } from "../../lib/haptics";
import {
  deviceChoices,
  looksLikeBluetooth,
  reconcileDeviceId,
  SYSTEM_DEFAULT_DEVICE,
  selectedDeviceLabel,
} from "../../lib/voice/media-device-choices";
import { useBluetoothAudioName } from "../../lib/voice/use-bluetooth-audio";
import { useVoice } from "../../providers/VoiceProvider";
import { ListGroup, ListHeader, ListRow } from "../chat/List";
import { PickerSheet } from "../kanban/PickerSheet";

const RESOLUTIONS: readonly VoiceDeviceSettings["videoResolution"][] = ["360p", "720p", "1080p"];
const RESOLUTION_OPTIONS = RESOLUTIONS.map((value) => ({ value, label: value }));

type UpdateSettings = (patch: Partial<VoiceDeviceSettings>) => void;

function DevicePicker({
  label,
  kind,
  devices,
  selected,
  bluetoothName,
  onSelect,
  onOpen,
}: {
  readonly label: string;
  readonly kind: MediaDeviceInfo["kind"];
  readonly devices: readonly MediaDeviceInfo[];
  readonly selected: string | null;
  readonly bluetoothName: string | undefined;
  readonly onSelect: (_deviceId: string | null) => void;
  readonly onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = selectedDeviceLabel(devices, kind, selected);
  const choices = deviceChoices(devices, kind, kind === "videoinput" ? undefined : bluetoothName);
  const available = devices.some((device) => device.kind === kind);
  const detail =
    selected === null
      ? kind === "videoinput"
        ? undefined
        : bluetoothName === undefined
          ? "Follows this device's audio route"
          : `Bluetooth · ${bluetoothName}`
      : looksLikeBluetooth(current)
        ? "Bluetooth"
        : undefined;
  return (
    <View>
      <ListHeader title={label} />
      <ListGroup inset={16}>
        <ListRow
          title={current}
          subtitle={detail}
          chevron
          onPress={() => {
            onOpen();
            setOpen(true);
          }}
        />
      </ListGroup>
      {!available && (
        <Text size="xs" tone="muted" className="px-1 pt-1.5">
          No devices detected yet.
        </Text>
      )}
      {open && (
        <PickerSheet
          title={label}
          options={choices}
          selected={[selected ?? SYSTEM_DEFAULT_DEVICE]}
          onChange={(next) => {
            const id = next.at(0) ?? SYSTEM_DEFAULT_DEVICE;
            selectionFeedback();
            onSelect(id === SYSTEM_DEFAULT_DEVICE ? null : id);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
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
    <SwitchRow
      label={label}
      description={description}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        selectionFeedback();
        onChange(next);
      }}
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
 * inside the members sheet’s voice settings modal.
 */
export function DeviceSettingsSection() {
  const { settings, devices, updateSettings, micLevelAvailable, callId, refreshDevices } =
    useVoice();
  const bluetooth = useBluetoothAudioName();
  const pushToTalkUnavailable = callId !== null && !micLevelAvailable;
  const update: UpdateSettings = (patch) => {
    void updateSettings(patch);
  };

  // A saved device can vanish between sessions (a Bluetooth headset is the
  // common case). Clear it so the next call follows the system route instead of
  // asking for an exact device id the platform cannot satisfy.
  useEffect(() => {
    if (devices.length === 0) return;
    const inputDeviceId = reconcileDeviceId(devices, "audioinput", settings.inputDeviceId);
    const outputDeviceId = reconcileDeviceId(devices, "audiooutput", settings.outputDeviceId);
    const cameraDeviceId = reconcileDeviceId(devices, "videoinput", settings.cameraDeviceId);
    if (
      inputDeviceId !== settings.inputDeviceId ||
      outputDeviceId !== settings.outputDeviceId ||
      cameraDeviceId !== settings.cameraDeviceId
    ) {
      void updateSettings({ inputDeviceId, outputDeviceId, cameraDeviceId });
    }
  }, [
    devices,
    settings.inputDeviceId,
    settings.outputDeviceId,
    settings.cameraDeviceId,
    updateSettings,
  ]);

  const refresh = () => {
    void refreshDevices();
    bluetooth.refresh();
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 24 }}>
      <DevicePicker
        label="Microphone"
        kind="audioinput"
        devices={devices}
        selected={settings.inputDeviceId}
        bluetoothName={bluetooth.name}
        onOpen={refresh}
        onSelect={(deviceId) => {
          update({ inputDeviceId: deviceId });
        }}
      />
      <DevicePicker
        label="Camera"
        kind="videoinput"
        devices={devices}
        selected={settings.cameraDeviceId}
        bluetoothName={undefined}
        onOpen={refresh}
        onSelect={(deviceId) => {
          update({ cameraDeviceId: deviceId });
        }}
      />
      <DevicePicker
        label="Speaker"
        kind="audiooutput"
        devices={devices}
        selected={settings.outputDeviceId}
        bluetoothName={bluetooth.name}
        onOpen={refresh}
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
