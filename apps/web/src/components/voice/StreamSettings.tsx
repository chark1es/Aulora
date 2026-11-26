import type { StreamFrameRate, StreamResolution } from "@aulora/core";
import { SegmentedControl, Switch, Text } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";

const RESOLUTIONS: readonly { value: StreamResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "4K" },
];

/** The segmented control carries strings, so the frame rate travels as "60" and back. */
const FRAME_RATES: readonly { value: `${StreamFrameRate}`; label: string }[] = [
  { value: "15", label: "15 fps" },
  { value: "30", label: "30 fps" },
  { value: "60", label: "60 fps" },
];

function toFrameRate(value: `${StreamFrameRate}`): StreamFrameRate {
  return value === "15" ? 15 : value === "30" ? 30 : 60;
}

function describe(resolution: StreamResolution, frameRate: StreamFrameRate): string {
  const rate =
    frameRate === 60
      ? "60 fps suits video, games and scrolling."
      : frameRate === 30
        ? "30 fps is smooth for most screens and lighter on the connection."
        : "15 fps keeps text sharpest and is easiest on the connection.";
  const upload =
    resolution === "1440p" || resolution === "2160p" ? " 1440p and 4K need a fast upload." : "";
  return `${rate}${upload}`;
}

/** The size and smoothness of a shared screen or window, and whether its sound goes along. */
export function StreamSettings() {
  const voice = useVoice();
  const { settings } = voice;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-text-muted">Resolution</span>
      <SegmentedControl
        label="Screen sharing resolution"
        value={settings.streamResolution}
        options={RESOLUTIONS}
        onChange={(streamResolution) => void voice.updateSettings({ streamResolution })}
        className="w-full"
      />
      <span className="text-[12px] font-medium text-text-muted">Frame rate</span>
      <SegmentedControl
        label="Screen sharing frame rate"
        value={`${settings.streamFrameRate}`}
        options={FRAME_RATES}
        onChange={(value) => void voice.updateSettings({ streamFrameRate: toFrameRate(value) })}
        className="w-full"
      />
      <Text tone="muted" size="xs">
        {describe(settings.streamResolution, settings.streamFrameRate)} Applies the next time you
        start sharing.
      </Text>
      <div className="border-y border-border/60 px-3.5">
        <Switch
          checked={settings.streamAudio}
          onChange={(streamAudio) => void voice.updateSettings({ streamAudio })}
          label="Share sound from the screen"
          description="Includes audio from the window, tab or screen you share, when your browser allows it. Needs the workspace’s streaming server."
        />
      </div>
    </div>
  );
}
