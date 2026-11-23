"""NVIDIA Parakeet TDT 0.6B v3 (multilingual) through ``onnx-asr``.

The heavy imports (``onnx_asr``, ``huggingface_hub``, ``numpy``) are lazy so
token/frame/model/segmentation tests do not need them installed. Audio is
processed in memory only; nothing is written to disk except the downloaded
model files in ``<models_dir>/parakeet-tdt-0.6b-v3``.

Parakeet already emits punctuation and capitalization and does not report the
spoken language, so segments carry ``language=None``.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any

from .frames import SAMPLE_RATE_HZ, pcm16_to_float32
from .models import is_allowed_model

# Pinned so a force-push upstream cannot change what the owner downloads.
REPO_ID = "istupakov/parakeet-tdt-0.6b-v3-onnx"
REVISION = "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce"
ONNX_ASR_MODEL_NAME = "nemo-parakeet-tdt-0.6b-v3"
# Only the int8 weights (about 650 MB) are fetched, never the fp32 ones.
MODEL_FILES: tuple[str, ...] = (
    "config.json",
    "vocab.txt",
    "encoder-model.int8.onnx",
    "decoder_joint-model.int8.onnx",
)

# A sentence longer than this is split at the next word boundary.
MAX_SENTENCE_SECONDS = 15.0
# Token timestamps are start times; the last token lasts roughly this long.
LAST_TOKEN_SECONDS = 0.1
# The encoder subsamples 8x of 10 ms frames, so anything shorter has no output.
MIN_AUDIO_SAMPLES = SAMPLE_RATE_HZ // 10
SENTENCE_END = (".", "?", "!")
CLOSING_CHARS = "\"')]}»”’"


@dataclass
class EngineSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None
    language: str | None


def model_dir(models_dir: str, model_id: str) -> str:
    return os.path.join(models_dir, model_id)


def missing_model_files(directory: str) -> list[str]:
    return [name for name in MODEL_FILES if not os.path.isfile(os.path.join(directory, name))]


def download_model_files(directory: str) -> None:
    """Fetches the pinned int8 files; resumes a partial download."""
    from huggingface_hub import snapshot_download

    snapshot_download(
        repo_id=REPO_ID,
        revision=REVISION,
        local_dir=directory,
        allow_patterns=list(MODEL_FILES),
    )


def _ends_sentence(token: str) -> bool:
    return token.rstrip().rstrip(CLOSING_CHARS).endswith(SENTENCE_END)


def _confidence(logprobs: list[float | None] | None) -> float | None:
    if not logprobs:
        return None
    values = [math.exp(min(0.0, float(lp))) for lp in logprobs if lp is not None]
    if not values:
        return None
    return max(0.0, min(1.0, sum(values) / len(values)))


def split_sentences(result: Any, audio_ms: int) -> list[EngineSegment]:
    """Splits a ``TimestampedResult``-like object into sentence segments.

    ``result`` needs ``text`` and optionally ``tokens``, ``timestamps`` (seconds
    per token) and ``logprobs``. A break follows a token ending in ``.``, ``?``
    or ``!`` when the next token starts a new word (so "3.5" stays whole), and
    is forced at a word boundary once a sentence passes
    ``MAX_SENTENCE_SECONDS``. Without usable timestamps the whole window is one
    segment. Only empty text is dropped.
    """
    text = (getattr(result, "text", "") or "").strip()
    tokens = getattr(result, "tokens", None)
    timestamps = getattr(result, "timestamps", None)
    logprobs = getattr(result, "logprobs", None)
    if logprobs is not None and tokens is not None and len(logprobs) != len(tokens):
        logprobs = None
    if not text and not tokens:
        return []
    if not tokens or not timestamps or len(timestamps) != len(tokens):
        if not text:
            return []
        return [EngineSegment(0, max(0, audio_ms), text, _confidence(logprobs), None)]

    groups: list[list[int]] = []
    current: list[int] = []
    for index, token in enumerate(tokens):
        word_start = token.startswith(" ")
        if (
            current
            and word_start
            and (
                _ends_sentence(tokens[current[-1]])
                or timestamps[index] - timestamps[current[0]] > MAX_SENTENCE_SECONDS
            )
        ):
            groups.append(current)
            current = []
        current.append(index)
    if current:
        groups.append(current)

    segments: list[EngineSegment] = []
    for group in groups:
        sentence = "".join(tokens[i] for i in group).strip()
        if not sentence:
            continue
        start_ms = min(max(0, int(timestamps[group[0]] * 1000)), max(0, audio_ms))
        end_ms = int((timestamps[group[-1]] + LAST_TOKEN_SECONDS) * 1000)
        end_ms = max(start_ms, min(end_ms, max(0, audio_ms)))
        confidence = _confidence([logprobs[i] for i in group] if logprobs else None)
        segments.append(EngineSegment(start_ms, end_ms, sentence, confidence, None))
    return segments


class ParakeetEngine:
    def __init__(self, model_id: str, models_dir: str, *, allow_download: bool = False) -> None:
        if not is_allowed_model(model_id):
            raise ValueError("unknown model")
        directory = model_dir(models_dir, model_id)
        if allow_download:
            download_model_files(directory)
        # `load_model` downloads silently when the path is absent, and treats an
        # existing path as complete, so check the files ourselves first.
        if not os.path.isdir(directory) or missing_model_files(directory):
            raise FileNotFoundError("model files are not installed")

        import onnx_asr

        kwargs: dict[str, Any] = {"path": directory, "quantization": "int8"}
        threads = os.environ.get("TRANSCRIBER_THREADS", "").strip()
        if threads.isdigit() and int(threads) > 0:
            import onnxruntime

            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = int(threads)
            kwargs["sess_options"] = options
        self.model_id = model_id
        # onnxruntime sessions are safe for concurrent `run`, so one engine
        # serves every stream's worker thread.
        self.model = onnx_asr.load_model(ONNX_ASR_MODEL_NAME, **kwargs).with_timestamps()

    def transcribe(self, pcm: bytes, language: str | None = None) -> list[EngineSegment]:
        samples = len(pcm) // 2
        if samples < MIN_AUDIO_SAMPLES:
            return []
        audio = pcm16_to_float32(pcm[: samples * 2])
        result = self.model.recognize(audio, sample_rate=SAMPLE_RATE_HZ)
        return split_sentences(result, samples * 1000 // SAMPLE_RATE_HZ)


def load_engine(model_id: str, models_dir: str, *, allow_download: bool = False) -> ParakeetEngine:
    return ParakeetEngine(model_id, models_dir, allow_download=allow_download)
