"""Utterance-aware PCM window segmentation with wall-clock gaps.

Separated from :mod:`app.main` so tests can drive the real stream with a fake
engine and a fake clock without FastAPI.

Audio is buffered and handed to the engine at a natural pause, not on a fixed
timer: cutting a sentence in half makes both halves harder to transcribe. A
window is cut when

* it holds at least ``MIN_WINDOW_MS`` and ends in ``TRAILING_SILENCE_MS`` of
  silence, or
* it reaches ``MAX_WINDOW_MS``, in which case it is cut at the quietest point of
  the last ``FORCED_CUT_SEARCH_MS`` and the remainder starts the next window.

"Silence" is relative to the window's own speech level (so a quiet speaker
still pauses) with an absolute floor (so room noise is never mistaken for
speech). Only the stdlib is used here so tests need no heavy dependencies.
"""

from __future__ import annotations

import sys
from array import array
from dataclasses import dataclass, field
from math import sqrt
from typing import Any, Callable

from .frames import SAMPLE_RATE_HZ
from .streams import WindowTimeline

BYTES_PER_SAMPLE = 2

# Never hand the engine less than this much audio at a pause, so a short
# "yes." is not sent on its own before the sentence continues.
MIN_WINDOW_MS = 1_800
# Longer than any usual utterance; the engine copes with this much in one pass.
MAX_WINDOW_MS = 20_000
# A pause this long ends an utterance.
TRAILING_SILENCE_MS = 500
# Energy is measured per 100 ms frame, the size clients send.
ENERGY_FRAME_MS = 100
# A forced cut looks for the quietest frame in this much trailing audio.
FORCED_CUT_SEARCH_MS = 1_500
# Absolute floor on the int16 scale (about -50 dBFS): a frame below this is
# silence whatever the speaker's level, and a window with no frame above it is
# skipped without calling the engine.
SILENCE_FLOOR_RMS = 100.0
# A frame is a pause when quieter than this fraction of the window's speech
# level (-14 dB), but never below the absolute floor.
RELATIVE_SILENCE_RATIO = 0.2
# The speech level is this quantile of the frames above the floor, which keeps a
# single click from raising the pause threshold.
SPEECH_LEVEL_QUANTILE = 0.75
# A pause at least this long is a discontinuity, not a normal frame gap.
DISCONTINUITY_MS = 1_000
# Windows shorter than this are dropped on `flush` (not on `drain`).
FLUSH_MIN_BYTES = SAMPLE_RATE_HZ


def _ms_to_bytes(ms: int, sample_rate_hz: int) -> int:
    return (sample_rate_hz * ms // 1000) * BYTES_PER_SAMPLE


def frame_rms(chunk: bytes) -> float:
    """RMS of little-endian PCM16 on the int16 scale (0 for an empty chunk)."""
    usable = len(chunk) - (len(chunk) % BYTES_PER_SAMPLE)
    if usable <= 0:
        return 0.0
    samples = array("h")
    samples.frombytes(chunk[:usable])
    if sys.byteorder == "big":
        samples.byteswap()
    return sqrt(sum(s * s for s in samples) / len(samples))


def speech_threshold(levels: list[float]) -> float | None:
    """Pause threshold for a window, or ``None`` if nothing is above the floor."""
    active = sorted(level for level in levels if level >= SILENCE_FLOOR_RMS)
    if not active:
        return None
    speech_level = active[int(SPEECH_LEVEL_QUANTILE * (len(active) - 1))]
    return max(SILENCE_FLOOR_RMS, RELATIVE_SILENCE_RATIO * speech_level)


@dataclass
class SegmentStream:
    session_id: str
    speaker_key: str
    engine_getter: Callable[[], Any | None]
    sample_rate_hz: int = SAMPLE_RATE_HZ
    min_window_bytes: int = 0
    max_window_bytes: int = 0
    buffer: bytearray = field(default_factory=bytearray)
    timeline: WindowTimeline = field(
        default_factory=lambda: WindowTimeline(base_offset_ms=0, opened_at_ms=0)
    )
    # RMS of each complete energy frame already scanned in `buffer`.
    levels: list[float] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        if self.min_window_bytes <= 0:
            self.min_window_bytes = _ms_to_bytes(MIN_WINDOW_MS, self.sample_rate_hz)
        if self.max_window_bytes <= 0:
            self.max_window_bytes = _ms_to_bytes(MAX_WINDOW_MS, self.sample_rate_hz)
        self.frame_bytes = _ms_to_bytes(ENERGY_FRAME_MS, self.sample_rate_hz)

    # -- feeding -----------------------------------------------------------

    def feed(self, data: bytes) -> list[dict[str, object]]:
        batches: list[dict[str, object]] = []
        # A mute or a network gap arrives as a jump in frame time. Flush the
        # partial window first so its own timestamp is used, then start the new
        # window at the new arrival time.
        if len(self.buffer) > 0 and self.timeline.gap_ms() >= DISCONTINUITY_MS:
            batches.extend(self._flush())
        if len(self.buffer) == 0:
            self.timeline.first_frame()
        self.buffer.extend(data)
        self.timeline.mark_arrival()
        self._scan()
        while len(self.buffer) >= self.max_window_bytes:
            batches.extend(self._flush(cut=self._forced_cut()))
            self._scan()
        if len(self.buffer) >= self.min_window_bytes and self._ends_in_pause():
            batches.extend(self._flush())
        return batches

    def _scan(self) -> None:
        """Measures energy for each newly completed frame (incremental)."""
        start = len(self.levels) * self.frame_bytes
        while start + self.frame_bytes <= len(self.buffer):
            chunk = bytes(self.buffer[start : start + self.frame_bytes])
            self.levels.append(frame_rms(chunk))
            start += self.frame_bytes

    def _ends_in_pause(self) -> bool:
        needed = max(1, TRAILING_SILENCE_MS // ENERGY_FRAME_MS)
        if len(self.levels) < needed:
            return False
        threshold = speech_threshold(self.levels)
        if threshold is None:
            # Nothing but silence: cut now so it is skipped, not buffered.
            return True
        return all(level < threshold for level in self.levels[-needed:])

    def _forced_cut(self) -> int:
        """Byte offset of the quietest point in the last search span.

        The cut lands in the middle of the quietest frame, at most
        ``max_window_bytes`` into the buffer.
        """
        search = max(1, FORCED_CUT_SEARCH_MS // ENERGY_FRAME_MS)
        limit = min(len(self.levels), self.max_window_bytes // self.frame_bytes)
        first = max(0, limit - search)
        if limit <= first:
            return self.max_window_bytes
        # Latest frame wins ties so the window is as long as possible.
        quietest = min(range(first, limit), key=lambda i: (self.levels[i], -i))
        cut = quietest * self.frame_bytes + self.frame_bytes // 2
        return cut - (cut % BYTES_PER_SAMPLE)

    # -- flushing ----------------------------------------------------------

    def _take(self, cut: int | None) -> tuple[bytes, int, bool]:
        """Removes the window from the buffer; returns audio, offset, has_speech.

        With ``cut`` the bytes after it stay buffered and keep a correct
        offset on the session timeline.
        """
        if cut is None or cut >= len(self.buffer):
            data = bytes(self.buffer)
            self.buffer.clear()
            offset = self.timeline.take_offset()
            levels = self.levels
            self.levels = []
        else:
            data = bytes(self.buffer[:cut])
            del self.buffer[:cut]
            consumed_ms = cut * 1000 // (self.sample_rate_hz * BYTES_PER_SAMPLE)
            offset = self.timeline.split_offset(consumed_ms)
            # Frame boundaries move with the cut; the remainder is rescanned.
            levels = self.levels[: cut // self.frame_bytes]
            self.levels = []
        tail_start = (len(levels)) * self.frame_bytes
        peak = max(levels) if levels else 0.0
        if tail_start < len(data):
            peak = max(peak, frame_rms(data[tail_start:]))
        return data, offset, peak >= SILENCE_FLOOR_RMS

    def _flush(self, cut: int | None = None) -> list[dict[str, object]]:
        engine = self.engine_getter()
        data, offset, has_speech = self._take(cut)
        if engine is None or not has_speech:
            return []
        engine_segments = engine.transcribe(data)
        payload: list[dict[str, object]] = []
        for segment in engine_segments:
            # Sequence numbers are assigned by the registry's per-identity
            # delivery gate, in the same order the batches are posted.
            entry: dict[str, object] = {
                "startMs": offset + segment.start_ms,
                "endMs": offset + segment.end_ms,
                "text": segment.text,
            }
            if segment.confidence is not None:
                entry["confidence"] = segment.confidence
            if segment.language:
                entry["language"] = segment.language
            payload.append(entry)
        return payload

    async def flush(self) -> list[dict[str, object]]:
        if len(self.buffer) < FLUSH_MIN_BYTES:
            self.buffer.clear()
            self.levels = []
            return []
        import asyncio

        return await asyncio.to_thread(self._flush)

    async def drain(self) -> list[dict[str, object]]:
        """Flushes any remaining audio, however short, exactly once.

        Used by every teardown path so a partial window before a mute or a
        disconnect is not lost. The buffer is cleared by ``_flush``; a second
        drain posts nothing.
        """
        if len(self.buffer) == 0:
            return []
        import asyncio

        return await asyncio.to_thread(self._flush)
