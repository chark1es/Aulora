import type { MediaDeviceInfo, VoiceDeviceSettings } from "@aulora/core";
import { cn, Icon, SegmentedControl, Select, Switch, Text } from "@aulora/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireUserMedia, createLevelMeter, supportsOutputSelection } from "../../lib/voice/media";
import { useVoice } from "../../providers/VoiceProvider";
import type { Callback } from "../admin/callbacks";
import { BackgroundSettings } from "./BackgroundSettings";
import { NoiseSuppressionSetting } from "./NoiseSuppressionSetting";
import { StreamSettings } from "./StreamSettings";

const DEVICE_NONE = "__default__";

function deviceOptions(devices: readonly MediaDeviceInfo[], kind: MediaDeviceInfo["kind"]) {
  return [
    { value: DEVICE_NONE, label: "System default" },
    ...devices
      .filter((device) => device.kind === kind)
      .map((device) => ({ value: device.deviceId, label: device.label })),
  ];
}

/**
 * Voice & video device settings, embedded in the user settings surface. Every
 * change is applied live to an ongoing call (the engine swaps tracks without
 * renegotiating) and persisted for the next one.
 */
export function DeviceSettingsSection() {
  const voice = useVoice();
  const { settings, devices } = voice;
  const [testing, setTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const testStream = useRef<MediaStream | null>(null);
  const testStop = useRef<(() => void) | null>(null);

  const stopTest = useCallback(() => {
    testStop.current?.();
    testStop.current = null;
    testStream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    testStream.current = null;
    setTestLevel(0);
    setTesting(false);
  }, []);

  useEffect(() => stopTest, [stopTest]);

  const startTest = useCallback(async () => {
    try {
      const stream = await acquireUserMedia({ settings, withVideo: false });
      testStream.current = stream;
      testStop.current = createLevelMeter(stream, setTestLevel);
      setTesting(true);
    } catch {
      setTesting(false);
    }
  }, [settings]);

  const level = voice.call !== null ? voice.micLevel : testLevel;
  const outputSelectable = supportsOutputSelection();

  return (
    <section className="flex flex-col gap-4" aria-label="Voice and video">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <Icon name="headphones" size={17} />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-text">Voice &amp; video</h3>
          <p className="text-[12px] text-text-muted">Choose how you sound and look on calls.</p>
        </div>
      </div>

      <Select
        label="Microphone"
        value={settings.inputDeviceId ?? DEVICE_NONE}
        options={deviceOptions(devices, "audioinput")}
        onChange={(value) =>
          void voice.updateSettings({ inputDeviceId: value === DEVICE_NONE ? null : value })
        }
      />

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-text-muted">Input level</span>
        <div className="flex items-center gap-2">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-75",
                level > 0.85 ? "bg-danger" : level > 0.6 ? "bg-idle" : "bg-secondary",
              )}
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              testing ? stopTest() : void startTest();
            }}
            className={cn(
              "h-7 shrink-0 rounded-[7px] px-2.5 text-[12px] font-medium transition",
              testing
                ? "bg-danger/15 text-danger hover:bg-danger/25"
                : "bg-surface-3 text-text hover:brightness-110",
            )}
          >
            {testing ? "Stop test" : "Test"}
          </button>
        </div>
      </div>

      <Select
        label="Speaker"
        value={settings.outputDeviceId ?? DEVICE_NONE}
        options={deviceOptions(devices, "audiooutput")}
        onChange={(value) =>
          void voice.updateSettings({ outputDeviceId: value === DEVICE_NONE ? null : value })
        }
        {...(outputSelectable ? {} : { className: "pointer-events-none opacity-50" })}
      />

      <Select
        label="Camera"
        value={settings.cameraDeviceId ?? DEVICE_NONE}
        options={deviceOptions(devices, "videoinput")}
        onChange={(value) =>
          void voice.updateSettings({ cameraDeviceId: value === DEVICE_NONE ? null : value })
        }
      />

      <RangeSetting
        label="Input volume"
        value={settings.inputVolume}
        max={2}
        onChange={(inputVolume) => void voice.updateSettings({ inputVolume })}
      />
      <RangeSetting
        label="Output volume"
        value={settings.outputVolume}
        max={2}
        onChange={(outputVolume) => void voice.updateSettings({ outputVolume })}
      />
      <RangeSetting
        label="Noise gate"
        value={settings.noiseGateThreshold}
        max={0.5}
        step={0.01}
        onChange={(noiseGateThreshold) => void voice.updateSettings({ noiseGateThreshold })}
      />
      <Text tone="muted" size="xs">
        The gate silences input below this level. Set it to zero to leave the mic open.
      </Text>

      <NoiseSuppressionSetting />

      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={settings.echoCancellation}
          onChange={(echoCancellation) => void voice.updateSettings({ echoCancellation })}
          label="Echo cancellation"
          description="Removes echo from speakers bleeding into your microphone."
        />
        <Switch
          checked={settings.autoGainControl}
          onChange={(autoGainControl) => void voice.updateSettings({ autoGainControl })}
          label="Automatic gain control"
          description="Keeps your level steady as you move around."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-muted">Camera quality</span>
        <SegmentedControl
          label="Camera quality"
          value={settings.videoResolution}
          options={[
            { value: "360p", label: "360p" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
          ]}
          onChange={(videoResolution) => void voice.updateSettings({ videoResolution })}
          className="w-full"
        />
      </div>

      <BackgroundSettings />

      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={settings.mirrorCamera}
          onChange={(mirrorCamera) => void voice.updateSettings({ mirrorCamera })}
          label="Mirror my camera"
          description="Flip your self-view, as in a mirror."
        />
        <Switch
          checked={settings.pushToTalk}
          onChange={(pushToTalk) => void voice.updateSettings({ pushToTalk })}
          label="Push to talk"
          description="Only transmit while the talk key is held."
        />
        <Switch
          checked={settings.joinMuted}
          onChange={(joinMuted) => void voice.updateSettings({ joinMuted })}
          label="Join muted"
          description="Start every call with your microphone off."
        />
        <Switch
          checked={settings.joinWithCamera}
          onChange={(joinWithCamera) => void voice.updateSettings({ joinWithCamera })}
          label="Join with camera on"
          description="Turn your camera on when you join a video call."
        />
      </div>

      <StreamSettings />

      <Text tone="muted" size="xs">
        Changes apply to the current call immediately.
      </Text>
    </section>
  );
}

function RangeSetting({
  label,
  value,
  max,
  step = 0.05,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: Callback<[value: number]>;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[12px] font-medium text-text-muted">
        {label}
        <span className="tabular-nums text-text-muted">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
      />
    </label>
  );
}

export type { VoiceDeviceSettings };
