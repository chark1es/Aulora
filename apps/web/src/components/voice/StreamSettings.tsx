import type { StreamQuality } from "@aulora/core";
import { SegmentedControl, Switch, Text } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";

function describe(quality: StreamQuality): string {
  switch (quality) {
    case "smooth":
      return "1080p at 30 frames a second. Best for video, animation and scrolling.";
    case "balanced":
      return "1080p at 15 frames a second. Sharp text for slides, documents and code.";
    case "saver":
      return "720p at 15 frames a second. Easiest on your connection.";
  }
}

/** How sharp a shared screen or window is, and whether its sound goes along. */
export function StreamSettings() {
  const voice = useVoice();
  const { settings } = voice;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-text-muted">Screen sharing quality</span>
      <SegmentedControl
        label="Screen sharing quality"
        value={settings.streamQuality}
        options={[
          { value: "smooth", label: "Smooth" },
          { value: "balanced", label: "Balanced" },
          { value: "saver", label: "Data saver" },
        ]}
        onChange={(streamQuality) => void voice.updateSettings({ streamQuality })}
        className="w-full"
      />
      <Text tone="muted" size="xs">
        {describe(settings.streamQuality)} Applies the next time you start sharing.
      </Text>
      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={settings.streamAudio}
          onChange={(streamAudio) => void voice.updateSettings({ streamAudio })}
          label="Share sound from the screen"
          description="Includes audio from the window, tab or screen you share, when your browser allows it. Needs the workspace's streaming server."
        />
      </div>
    </div>
  );
}
