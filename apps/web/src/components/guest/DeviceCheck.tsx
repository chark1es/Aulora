import type { MediaDeviceInfo as AuloraMediaDevice } from "@aulora/core";
import { Button, cn, Icon, Select } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";
import { mediaMessage } from "../../lib/voice/call-errors";
import { createLevelMeter, listMediaDevices } from "../../lib/voice/media";

/** What the guest chose in the lobby; applied when they are let in. */
export interface GuestMediaChoices {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly inputDeviceId: string | null;
  readonly cameraDeviceId: string | null;
}

export const DEFAULT_GUEST_CHOICES: GuestMediaChoices = {
  micOn: true,
  cameraOn: false,
  inputDeviceId: null,
  cameraDeviceId: null,
};

function stopAll(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

async function open(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia(constraints);
}

interface Preview {
  readonly audio: MediaStream | null;
  readonly video: MediaStream | null;
  readonly audioError: string | null;
  readonly videoError: string | null;
}

const EMPTY: Preview = { audio: null, video: null, audioError: null, videoError: null };

/**
 * The lobby's device check: nothing is requested until the guest asks, then a
 * live camera picture, a microphone level and the device pickers. Every track
 * opened here is released as soon as the guest is let in or leaves, so the
 * call starts from a clean device.
 */
export function DeviceCheck({
  choices,
  onChange,
}: {
  readonly choices: GuestMediaChoices;
  readonly onChange: (next: GuestMediaChoices) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Preview>(EMPTY);
  const [devices, setDevices] = useState<readonly AuloraMediaDevice[]>([]);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { micOn, cameraOn, inputDeviceId, cameraDeviceId } = choices;

  // Open the microphone (and camera) that the choices ask for while checking.
  useEffect(() => {
    if (!checking) {
      return;
    }
    let cancelled = false;
    let audio: MediaStream | null = null;
    let video: MediaStream | null = null;
    void (async () => {
      let audioError: string | null = null;
      let videoError: string | null = null;
      try {
        audio = await open({
          audio: inputDeviceId !== null ? { deviceId: { exact: inputDeviceId } } : true,
        });
      } catch (error) {
        audioError = mediaMessage(error);
      }
      if (cameraOn) {
        try {
          video = await open({
            video: cameraDeviceId !== null ? { deviceId: { exact: cameraDeviceId } } : true,
          });
        } catch (error) {
          videoError = mediaMessage(error).replace("Microphone and camera", "Camera");
        }
      }
      if (cancelled) {
        stopAll(audio);
        stopAll(video);
        return;
      }
      setPreview({ audio, video, audioError, videoError });
      // Labels only appear once permission has been granted.
      void listMediaDevices().then((list) => {
        if (!cancelled) {
          setDevices(list);
        }
      });
    })();
    return () => {
      cancelled = true;
      stopAll(audio);
      stopAll(video);
      setPreview(EMPTY);
      setLevel(0);
    };
  }, [checking, cameraOn, inputDeviceId, cameraDeviceId]);

  useEffect(() => {
    const stream = preview.audio;
    if (stream === null) {
      return;
    }
    return createLevelMeter(stream, setLevel);
  }, [preview.audio]);

  useEffect(() => {
    const element = videoRef.current;
    if (element === null) {
      return;
    }
    element.srcObject = preview.video;
    if (preview.video !== null) {
      void element.play().catch(() => undefined);
    }
  }, [preview.video]);

  const set = (patch: Partial<GuestMediaChoices>) => {
    onChange({ ...choices, ...patch });
  };
  const mics = devices.filter((device) => device.kind === "audioinput");
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const unsupported = typeof navigator === "undefined" || navigator.mediaDevices === undefined;

  return (
    <section aria-label="Check your camera and microphone" className="flex flex-col gap-3">
      <div
        className={cn(
          "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-card border border-border bg-surface-2",
        )}
      >
        {/* The preview is a mirror, so it is flipped like the in-call self view. */}
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Your camera preview"
          className={cn(
            "h-full w-full -scale-x-100 object-cover",
            preview.video === null && "hidden",
          )}
        />
        {preview.video === null && (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-text-muted">
            <Icon name="video-off" size={26} />
            <p className="text-[12.5px]">
              {!checking
                ? "Check how you look and sound before you ask to join."
                : cameraOn
                  ? (preview.videoError ?? "Starting your camera…")
                  : "Your camera is off."}
            </p>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/55 to-transparent p-3">
          <RoundToggle
            label={micOn ? "Turn off microphone" : "Turn on microphone"}
            on={micOn}
            onIcon="mic"
            offIcon="mic-off"
            onClick={() => {
              set({ micOn: !micOn });
            }}
          />
          <RoundToggle
            label={cameraOn ? "Turn off camera" : "Turn on camera"}
            on={cameraOn}
            onIcon="video"
            offIcon="video-off"
            onClick={() => {
              set({ cameraOn: !cameraOn });
            }}
          />
        </div>
      </div>

      {!checking ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={unsupported}
            leading={<Icon name="mic" size={14} />}
            onClick={() => {
              setChecking(true);
            }}
          >
            Check camera and microphone
          </Button>
          {unsupported && (
            <p className="mt-1.5 text-[12px] text-text-muted">
              Audio and video need a secure connection (https).
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Icon name={micOn ? "mic" : "mic-off"} size={15} className="shrink-0 text-text-muted" />
            {/* biome-ignore lint/a11y/useSemanticElements: a themed level bar; <meter> cannot be styled consistently across browsers */}
            <div
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={micOn ? Math.round(level * 100) : 0}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className="h-full rounded-full bg-secondary transition-[width] duration-75"
                style={{ width: `${micOn ? Math.round(level * 100) : 0}%` }}
              />
            </div>
          </div>
          {preview.audioError !== null && (
            <p role="alert" className="text-[12px] text-danger">
              {preview.audioError}
            </p>
          )}
          {preview.videoError !== null && cameraOn && (
            <p role="alert" className="text-[12px] text-danger">
              {preview.videoError}
            </p>
          )}
          {(mics.length > 1 || cameras.length > 1) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {mics.length > 1 && (
                <Select
                  label="Microphone"
                  value={inputDeviceId ?? ""}
                  onChange={(value) => {
                    set({ inputDeviceId: value === "" ? null : value });
                  }}
                  options={[
                    { value: "", label: "System default" },
                    ...mics.map((device) => ({ value: device.deviceId, label: device.label })),
                  ]}
                />
              )}
              {cameras.length > 1 && (
                <Select
                  label="Camera"
                  value={cameraDeviceId ?? ""}
                  onChange={(value) => {
                    set({ cameraDeviceId: value === "" ? null : value });
                  }}
                  options={[
                    { value: "", label: "System default" },
                    ...cameras.map((device) => ({ value: device.deviceId, label: device.label })),
                  ]}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RoundToggle({
  label,
  on,
  onIcon,
  offIcon,
  onClick,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onIcon: "mic" | "video";
  readonly offIcon: "mic-off" | "video-off";
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95",
        on
          ? "bg-surface-1/90 text-text hover:bg-surface-1"
          : "bg-danger text-on-accent hover:brightness-110",
      )}
    >
      <Icon name={on ? onIcon : offIcon} size={19} />
    </button>
  );
}
