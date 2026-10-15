import { SegmentedControl, Text } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import { enhancedNoiseSuppressionAvailable } from "../../lib/voice/mic-pipeline";
import { useVoice } from "../../providers/VoiceProvider";

type Level = "off" | "standard" | "enhanced";

function describe(level: Level): string {
  switch (level) {
    case "off":
      return "Sends your microphone as it is.";
    case "standard":
      return "Your browser reduces steady background hum and fans.";
    case "enhanced":
      return "A small AI model removes keyboard clatter, fans, traffic and other room noise while keeping your voice. Uses a little more processing power.";
  }
}

/** Off, the browser's built-in suppression, or the on-device AI denoiser. */
export function NoiseSuppressionSetting() {
  const voice = useVoice();
  const { settings } = voice;
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void enhancedNoiseSuppressionAvailable().then((result) => {
      if (!cancelled) {
        setAvailable(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const level: Level = !settings.noiseSuppression
    ? "off"
    : settings.enhancedNoiseSuppression
      ? "enhanced"
      : "standard";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-muted">Noise suppression</span>
      <SegmentedControl
        label="Noise suppression"
        value={level}
        options={[
          { value: "off", label: "Off" },
          { value: "standard", label: "Standard" },
          { value: "enhanced", label: "Enhanced" },
        ]}
        onChange={(next) =>
          void voice.updateSettings({
            noiseSuppression: next !== "off",
            enhancedNoiseSuppression: next === "enhanced",
          })
        }
        className="w-full"
      />
      <Text tone="muted" size="xs">
        {describe(level)}
      </Text>
      {level === "enhanced" && available === false && (
        <Text tone="muted" size="xs">
          Enhanced suppression is not available on this device, so Standard is used instead.
        </Text>
      )}
    </div>
  );
}
