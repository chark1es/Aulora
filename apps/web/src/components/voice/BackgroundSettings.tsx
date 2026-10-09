import { cn, SegmentedControl, Text } from "@aulora/ui-web";
import { useRef, useState } from "react";
import {
  BACKDROPS,
  backdropGradient,
  CUSTOM_BACKDROP_ID,
  clearCustomBackdrop,
  customBackdropUrl,
  saveCustomBackdrop,
} from "../../lib/voice/effects/backdrop";
import { backgroundEffectsSupported } from "../../lib/voice/effects/background-effect";
import { useVoice } from "../../providers/VoiceProvider";

/** Blur the room behind you, or put an image there instead. */
export function BackgroundSettings() {
  const voice = useVoice();
  const { settings } = voice;
  const supported = backgroundEffectsSupported();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-text-muted">Background</span>
      <SegmentedControl
        label="Background"
        value={settings.backgroundEffect}
        options={[
          { value: "none", label: "None" },
          { value: "blur", label: "Blur" },
          { value: "image", label: "Image" },
        ]}
        onChange={(backgroundEffect) => void voice.updateSettings({ backgroundEffect })}
        className={cn("w-full", !supported && "pointer-events-none opacity-50")}
      />
      {!supported && (
        <Text tone="muted" size="xs">
          Background effects need WebGL 2, which this browser does not offer.
        </Text>
      )}
      {supported && settings.backgroundEffect !== "none" && (
        <>
          <SegmentedControl
            label="Blur strength"
            value={settings.backgroundBlur}
            options={[
              { value: "light", label: "Light blur" },
              { value: "strong", label: "Strong blur" },
            ]}
            onChange={(backgroundBlur) => void voice.updateSettings({ backgroundBlur })}
            className="w-full"
          />
          {settings.backgroundEffect === "image" && <BackdropPicker />}
          <Text tone="muted" size="xs">
            Runs on your device; your camera picture is never sent anywhere to do this.
          </Text>
        </>
      )}
    </div>
  );
}

function BackdropPicker() {
  const voice = useVoice();
  const selected = voice.settings.backgroundImage;
  const input = useRef<HTMLInputElement | null>(null);
  const [custom, setCustom] = useState(customBackdropUrl);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = (backgroundImage: string) => {
    void voice.updateSettings({ backgroundImage });
  };

  const upload = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    try {
      await saveCustomBackdrop(file);
      setProblem(null);
      setCustom(customBackdropUrl());
      choose(CUSTOM_BACKDROP_ID);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That picture could not be used.");
    }
  };

  const remove = () => {
    clearCustomBackdrop();
    setCustom(null);
    if (selected === CUSTOM_BACKDROP_ID) {
      choose(BACKDROPS[0]?.id ?? "dusk");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Background image">
        {BACKDROPS.map((backdrop) => (
          <Swatch
            key={backdrop.id}
            label={backdrop.label}
            selected={selected === backdrop.id}
            style={{ backgroundImage: backdropGradient(backdrop) }}
            onSelect={() => {
              choose(backdrop.id);
            }}
          />
        ))}
        {custom !== null && (
          <Swatch
            label="Your picture"
            style={{
              backgroundImage: `url("${custom}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            selected={selected === CUSTOM_BACKDROP_ID}
            onSelect={() => {
              choose(CUSTOM_BACKDROP_ID);
            }}
          />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="flex gap-3 text-[12px]">
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => input.current?.click()}
        >
          {custom !== null ? "Replace your picture" : "Upload a picture"}
        </button>
        {custom !== null && (
          <button type="button" className="text-text-muted hover:underline" onClick={remove}>
            Remove it
          </button>
        )}
      </div>
      {problem !== null && (
        <Text tone="danger" size="xs">
          {problem}
        </Text>
      )}
    </div>
  );
}

function Swatch({
  label,
  selected,
  style,
  onSelect,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly style?: React.CSSProperties;
  readonly onSelect: () => void;
}) {
  return (
    <label
      title={label}
      style={style}
      className={cn(
        "relative flex aspect-video cursor-pointer items-center justify-center rounded-[8px] border bg-surface-3 transition focus-within:ring-2 focus-within:ring-accent",
        selected ? "border-accent ring-2 ring-accent/40" : "border-border hover:brightness-110",
      )}
    >
      <input
        type="radio"
        name="background-image"
        aria-label={label}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      {selected && <span className="text-[14px] font-bold text-white drop-shadow">✓</span>}
    </label>
  );
}
