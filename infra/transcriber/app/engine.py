"""faster-whisper wrapper.

The import is lazy so token/frame/model tests do not need the (large) engine
dependencies installed. Audio is processed in memory only; nothing is written to
disk except the downloaded model weights.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from .frames import pcm16_to_float32

HALLUCINATION_TEXTS = {
    "thank you.",
    "thanks for watching!",
    "thank you for watching.",
    "you",
    "bye.",
    "bye",
}

MIN_SEGMENT_SECONDS = 0.2
NO_SPEECH_PROBABILITY_CUTOFF = 0.6


@dataclass
class EngineSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None
    language: str | None


class WhisperEngine:
    def __init__(self, model_id: str, models_dir: str, *, allow_download: bool = False) -> None:
        from faster_whisper import WhisperModel

        self.model_id = model_id
        self.model = WhisperModel(
            model_id,
            device=os.environ.get("WHISPER_DEVICE", "cpu"),
            compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
            download_root=models_dir,
            local_files_only=not allow_download,
        )

    def transcribe(self, pcm: bytes, language: str | None = None) -> list[EngineSegment]:
        audio = pcm16_to_float32(pcm)
        segments, info = self.model.transcribe(
            audio,
            language=language,
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False,
        )
        detected = getattr(info, "language", None)
        results: list[EngineSegment] = []
        for segment in segments:
            text = (segment.text or "").strip()
            if not text:
                continue
            no_speech = getattr(segment, "no_speech_prob", 0.0) or 0.0
            if no_speech >= NO_SPEECH_PROBABILITY_CUTOFF:
                continue
            if text.lower() in HALLUCINATION_TEXTS:
                continue
            start_ms = int(segment.start * 1000)
            end_ms = int(segment.end * 1000)
            if end_ms - start_ms < MIN_SEGMENT_SECONDS * 1000:
                continue
            confidence = None
            average_logprob = getattr(segment, "avg_logprob", None)
            if average_logprob is not None:
                confidence = max(0.0, min(1.0, 1.0 + float(average_logprob)))
            results.append(
                EngineSegment(
                    start_ms=start_ms,
                    end_ms=end_ms,
                    text=text,
                    confidence=confidence,
                    language=detected if isinstance(detected, str) else None,
                )
            )
        return results


def load_engine(model_id: str, models_dir: str, *, allow_download: bool = False) -> WhisperEngine:
    return WhisperEngine(model_id, models_dir, allow_download=allow_download)
