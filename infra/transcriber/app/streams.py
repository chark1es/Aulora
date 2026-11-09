"""Connection bookkeeping and HTTP helpers, kept importable without FastAPI.

The WebSocket handlers live in :mod:`app.main`; this module holds the pieces
that unit tests can exercise without the server dependencies.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("aulora.transcriber")


class PermanentPostError(Exception):
    """Convex rejected a batch and retrying the same request cannot succeed."""

    def __init__(self, status: int) -> None:
        super().__init__(f"ingest rejected with HTTP {status}")
        self.status = status


@dataclass
class SequenceCounter:
    """Per ``(session, speaker)`` sequence, continued across reconnects.

    A replacement socket and the evicted socket's teardown drain may both flush
    from worker threads, so the counter is guarded against duplicate values.
    """

    value: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class DeliveryGate:
    """Assigns sequence numbers and posts batches in one serialized order.

    Owned by the registry, not a socket: an evicted socket's teardown drain and
    the replacement's first batches share this gate, so a batch is numbered and
    posted before the next one may start. A slow POST therefore delays later
    batches (head-of-line blocking is the point: a later sequence must never
    overtake an earlier one). The pending queue is bounded; only past
    ``max_pending`` waiters is a batch dropped and logged.
    """

    max_pending: int = 64
    sequence: SequenceCounter = field(default_factory=SequenceCounter)
    condition: threading.Condition = field(default_factory=threading.Condition)
    busy: bool = False
    pending: int = 0

    def idle(self) -> bool:
        """True when nothing is being posted and no batch is waiting."""
        with self.condition:
            return not self.busy and self.pending == 0

    def deliver(
        self,
        post: Callable[[str, str, list[dict[str, object]]], bool],
        session_id: str,
        speaker_key: str,
        segments: list[dict[str, object]],
    ) -> bool:
        if not segments:
            return True
        with self.condition:
            if self.pending >= self.max_pending:
                # Never log audio or a token; the names only identify the seat.
                logger.warning(
                    "transcriber ingest queue full for %s/%s; dropping one batch",
                    session_id,
                    speaker_key,
                )
                return False
            self.pending += 1
            while self.busy:
                self.condition.wait()
            self.busy = True
        try:
            batch: list[dict[str, object]] = []
            with self.sequence.lock:
                for segment in segments:
                    self.sequence.value += 1
                    batch.append({"seq": self.sequence.value, **segment})
            return post(session_id, speaker_key, batch)
        finally:
            with self.condition:
                self.busy = False
                self.pending -= 1
                self.condition.notify_all()


@dataclass
class StreamRegistry:
    """Tracks live sockets per session and per identity.

    A new valid token for the same identity evicts the previous socket (which
    the caller closes) instead of rejecting a quick reconnect with 4429.
    """

    max_streams: int = 32
    by_session: dict[str, int] = field(default_factory=dict)
    by_identity: dict[tuple[str, str], Any] = field(default_factory=dict)
    deliveries: dict[tuple[str, str], DeliveryGate] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def acquire(self, sid: str, sub: str, websocket: Any) -> tuple[bool, Any | None]:
        """Reserves a stream, returning the previous socket to evict, if any.

        A reconnect replaces the identity's existing stream in this session
        without taking a second slot, so a full session can still reconnect.
        """
        async with self.lock:
            key = (sid, sub)
            previous = self.by_identity.get(key)
            if previous is None:
                if self.by_session.get(sid, 0) >= self.max_streams:
                    return False, None
                self.by_session[sid] = self.by_session.get(sid, 0) + 1
            self.by_identity[key] = websocket
            return True, previous

    async def release(self, sid: str, sub: str, websocket: Any) -> None:
        async with self.lock:
            key = (sid, sub)
            # Only the current socket frees the slot; an evicted predecessor
            # must not decrement a slot the replacement still holds.
            if self.by_identity.get(key) is websocket:
                del self.by_identity[key]
                self.by_session[sid] = max(0, self.by_session.get(sid, 0) - 1)
                gate = self.deliveries.get(key)
                # Evict the delivery state once this identity has no socket and
                # no in-flight/waiting batch. A replacement keeps it because the
                # newer socket is still mapped; the next reconnect after a gap
                # starts a fresh counter, which the session's restart rule
                # accepts when its clock has moved forward.
                if gate is not None and gate.idle():
                    del self.deliveries[key]

    async def delivery_for(self, sid: str, sub: str) -> DeliveryGate:
        async with self.lock:
            return self.deliveries.setdefault((sid, sub), DeliveryGate())


@dataclass
class PreAuthGate:
    """Caps sockets that have not authenticated yet."""

    limit: int = 128
    active: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def begin(self) -> bool:
        async with self.lock:
            if self.active >= self.limit:
                return False
            self.active += 1
            return True

    async def end(self) -> None:
        async with self.lock:
            self.active = max(0, self.active - 1)


def base_ms_for_session(session_start_ms: int, now_ms: int | None = None) -> int:
    """Session-relative offset of the moment a socket opens."""
    now = int(time.time() * 1000) if now_ms is None else now_ms
    return max(0, now - int(session_start_ms))


@dataclass
class WindowTimeline:
    """Maps audio windows to wall-clock offsets from the session start.

    The offset is captured when the first frame of a window arrives, from a
    monotonic clock, so a mute or a network gap leaves a real gap in the
    transcript instead of compressing it.
    """

    base_offset_ms: int
    opened_at_ms: int
    clock: Callable[[], float] = field(default_factory=lambda: lambda: time.monotonic() * 1000)
    window_started_offset_ms: int | None = None
    last_frame_at_ms: int | None = None

    def first_frame(self) -> None:
        if self.window_started_offset_ms is None:
            elapsed = max(0, int(self.clock() - self.opened_at_ms))
            self.window_started_offset_ms = self.base_offset_ms + elapsed

    def mark_arrival(self) -> None:
        self.last_frame_at_ms = int(self.clock())

    def gap_ms(self) -> int:
        if self.last_frame_at_ms is None:
            return 0
        return max(0, int(self.clock()) - self.last_frame_at_ms)

    def take_offset(self) -> int:
        if self.window_started_offset_ms is None:
            self.first_frame()
        assert self.window_started_offset_ms is not None
        offset = self.window_started_offset_ms
        self.window_started_offset_ms = None
        return offset


def post_json(
    url: str,
    payload: dict[str, object],
    secret: str,
    timeout: float = 15.0,
    *,
    attempts: int = 1,
    backoff: float = 0.0,
    opener=urllib.request.urlopen,
    stop_on_rejection: bool = False,
) -> bool:
    """POSTs JSON with the shared bearer secret and bounded retries.

    A 4xx (except 408/429) is permanent when ``stop_on_rejection`` is set: it is
    raised immediately, with no retry, because the same request can never
    succeed. 5xx, timeouts and connection errors stay retryable. Never logs
    request headers (the bearer secret) or payload content.
    """
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {secret}",
            "cache-control": "no-store",
        },
        method="POST",
    )
    for attempt in range(max(1, attempts)):
        try:
            with opener(request, timeout=timeout) as response:
                if 200 <= response.status < 300:
                    return True
                logger.warning("transcriber POST %s returned HTTP %s", url, response.status)
        except urllib.error.HTTPError as error:
            if (
                stop_on_rejection
                and 400 <= error.code < 500
                and error.code not in (408, 429)
            ):
                raise PermanentPostError(error.code) from None
            logger.warning("transcriber POST %s failed (attempt %s): %s", url, attempt + 1, error)
        except (urllib.error.URLError, OSError) as error:
            logger.warning("transcriber POST %s failed (attempt %s): %s", url, attempt + 1, error)
        if attempt + 1 < max(1, attempts):
            time.sleep(backoff * (2**attempt))
    return False
