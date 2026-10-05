import { useEffect, useRef } from "react";
import { applySinkId, createOutputGain, type OutputGain } from "../lib/voice/media";

/** Hidden audio elements for every remote participant, honouring the speaker choice. */
export function RemoteAudio({
  streams,
  deafened,
  outputDeviceId,
  outputVolume,
}: {
  readonly streams: ReadonlyMap<string, MediaStream>;
  readonly deafened: boolean;
  readonly outputDeviceId: string | null;
  readonly outputVolume: number;
}) {
  return (
    <>
      {[...streams.entries()].map(([userId, stream]) => (
        <RemoteAudioElement
          key={userId}
          stream={stream}
          deafened={deafened}
          outputDeviceId={outputDeviceId}
          outputVolume={outputVolume}
        />
      ))}
    </>
  );
}

function RemoteAudioElement({
  stream,
  deafened,
  outputDeviceId,
  outputVolume,
}: {
  readonly stream: MediaStream;
  readonly deafened: boolean;
  readonly outputDeviceId: string | null;
  readonly outputVolume: number;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const boostRef = useRef<OutputGain | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (ref.current !== null) {
      void applySinkId(ref.current, outputDeviceId);
    }
  }, [outputDeviceId]);

  // Past unity the element's `volume` cannot go, so route through a WebAudio
  // gain instead; at or below unity the element plays directly and keeps the
  // chosen output device.
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (outputVolume <= 1) {
      boostRef.current?.stop();
      boostRef.current = null;
      element.volume = Math.max(0, outputVolume);
    } else {
      element.volume = 1;
      if (boostRef.current === null) {
        boostRef.current = createOutputGain(stream, outputVolume);
      } else {
        boostRef.current.setVolume(outputVolume);
      }
    }
  }, [outputVolume, stream]);

  useEffect(
    () => () => {
      boostRef.current?.stop();
      boostRef.current = null;
    },
    [],
  );

  return <audio ref={ref} autoPlay playsInline muted={deafened} className="hidden" />;
}
