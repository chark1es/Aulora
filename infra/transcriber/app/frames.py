"""Frame validation for the PCM16 WebSocket protocol."""

from __future__ import annotations

SAMPLE_RATE_HZ = 16_000
MAX_FRAME_BYTES = 16_384
MAX_IDLE_SECONDS = 60.0
AUTH_TIMEOUT_SECONDS = 3.0


def validate_frame(data: bytes) -> str | None:
    """Returns a close reason, or ``None`` when a binary frame is acceptable."""
    if len(data) == 0:
        return "empty_frame"
    if len(data) > MAX_FRAME_BYTES:
        return "frame_too_large"
    if len(data) % 2 != 0:
        return "odd_frame_length"
    return None


def pcm16_to_float32(data: bytes):
    """Converts little-endian signed 16-bit PCM to float32 in [-1, 1]."""
    import numpy as np

    samples = np.frombuffer(data, dtype="<i2").astype("float32")
    return samples / 32768.0
