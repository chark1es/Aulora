"""PCM window segmentation with wall-clock gaps.

Separated from :mod:`app.main` so tests can drive the real stream with a fake
engine and a fake clock without FastAPI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .frames import SAMPLE_RATE_HZ
from .streams import WindowTimeline

# Two seconds of 16 kHz mono PCM16.
WINDOW_BYTES = SAMPLE_RATE_HZ * 2 * 2
# A pause at least this long is a discontinuity, not a normal frame gap.
DISCONTINUITY_MS = 1_000


@dataclass
class SegmentStream:
    session_id: str
    speaker_key: str
    engine_getter: Callable[[], Any | None]
    sample_rate_hz: int = SAMPLE_RATE_HZ
    window_bytes: int = WINDOW_BYTES
    buffer: bytearray = field(default_factory=bytearray)
    timeline: WindowTimeline = field(
        default_factory=lambda: WindowTimeline(base_offset_ms=0, opened_at_ms=0)
    )

    def feed(self, data: bytes) -> list[dict[str, object]]:
        batches: list[dict[str, object]] = []
        # A mute or a network gap arrives as a jump in frame time. Flush the
        # partial window first so its own timestamp is used, then start the new
        # window at the new arrival time.
        if len(self.buffer) > 0 and self.timeline.gap_ms() >= DISCONTINUITY_MS:
            batches.extend(self._flush())
            self.buffer.clear()
        if len(self.buffer) == 0:
            self.timeline.first_frame()
        self.buffer.extend(data)
        self.timeline.mark_arrival()
        if len(self.buffer) < self.window_bytes:
            return batches
        batches.extend(self._flush())
        return batches

    def _window(self) -> tuple[bytes, int]:
        data = bytes(self.buffer)
        self.buffer.clear()
        offset = self.timeline.take_offset()
        return data, offset

    def _flush(self) -> list[dict[str, object]]:
        engine = self.engine_getter()
        if engine is None:
            self.buffer.clear()
            return []
        data, offset = self._window()
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
        if len(self.buffer) < self.sample_rate_hz:
            self.buffer.clear()
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
