import { transcriptionClient, useTranscriptionClient } from "../../lib/transcription/client-state";
import { useVoice } from "../../providers/VoiceProvider";
import { TranscriptionNoticeView } from "./TranscriptionNoticeView";

/** The member-side notice: shown while the active call is being transcribed. */
export function TranscriptionNotice({ compact = false }: { readonly compact?: boolean }) {
  const voice = useVoice();
  const state = useTranscriptionClient();
  if (voice.call === null || voice.call.transcribing !== true) {
    return null;
  }
  return (
    <TranscriptionNoticeView
      state={state}
      compact={compact}
      {...(compact ? {} : { className: "mx-3 mt-2" })}
      onOptOutChange={(optedOut) => {
        transcriptionClient.setOptedOut(optedOut);
      }}
      onResume={() => {
        transcriptionClient.requestResume();
      }}
    />
  );
}
