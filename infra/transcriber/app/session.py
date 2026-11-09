"""The WebSocket stream loop, importable without FastAPI.

The handler in :mod:`app.main` owns authentication, the stream registry and
model readiness; this module owns the message loop and the one teardown drain
that every close path (explicit ``end``, idle timeout, client disconnect,
replacement eviction, server shutdown) runs exactly once.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from .frames import MAX_IDLE_SECONDS, validate_frame
from .protocol import CLOSE_BAD_FRAME, CLOSE_INTERNAL, CLOSE_NORMAL, CLOSE_SESSION_ENDED
from .segments import SegmentStream
from .streams import PermanentPostError

PostSegments = Callable[[str, str, list[dict[str, object]]], bool]

logger = logging.getLogger("aulora.transcriber")


async def drain_stream(
    stream: SegmentStream,
    session_id: str,
    speaker_key: str,
    post: PostSegments,
) -> None:
    """Transcribes and posts any buffered partial window once.

    ``SegmentStream.drain`` clears the buffer, so the explicit ``end`` path and
    the ``finally`` teardown cannot send the same window twice.
    """
    batch = await stream.drain()
    if batch:
        await asyncio.to_thread(post, session_id, speaker_key, batch)


async def serve_stream(
    websocket: Any,
    stream: SegmentStream,
    *,
    session_id: str,
    speaker_key: str,
    post: PostSegments,
    release: Callable[[], Awaitable[None]],
    disconnect_errors: tuple[type[BaseException], ...] = (),
    idle_timeout: float = MAX_IDLE_SECONDS,
) -> None:
    """Runs one authenticated stream until any teardown path is reached."""
    rejected = False
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=idle_timeout)
            except TimeoutError:
                await websocket.close(code=CLOSE_NORMAL, reason="idle")
                return
            if message.get("type") == "websocket.disconnect":
                return
            data = message.get("bytes")
            if data is not None:
                reason = validate_frame(data)
                if reason is not None:
                    await websocket.close(code=CLOSE_BAD_FRAME, reason=reason)
                    return
                batch = await asyncio.to_thread(stream.feed, data)
                if batch:
                    await asyncio.to_thread(post, session_id, speaker_key, batch)
                continue
            text = message.get("text")
            if text:
                try:
                    control = json.loads(text)
                except ValueError:
                    continue
                if isinstance(control, dict) and control.get("type") == "end":
                    await drain_stream(stream, session_id, speaker_key, post)
                    await websocket.close(code=CLOSE_NORMAL, reason="ended")
                    return
    except PermanentPostError as error:
        # Convex said the session/speaker can never accept this audio again.
        # Retrying cannot help, so close terminally instead of reconnecting.
        rejected = True
        logger.warning(
            "transcriber ingest permanently rejected (%s); closing stream", error.status
        )
        try:
            await websocket.close(code=CLOSE_SESSION_ENDED, reason="session ended")
        except Exception:  # noqa: BLE001 - the peer may already be gone
            pass
        return
    except disconnect_errors:
        return
    except Exception:  # noqa: BLE001 - never log token or audio content
        try:
            await websocket.close(code=CLOSE_INTERNAL, reason="internal error")
        except Exception:  # noqa: BLE001 - the peer may already be gone
            pass
    finally:
        # A failed final transcription must not leak the registry slot or
        # escape the websocket handler. Log without any audio/token content.
        try:
            if not rejected:
                await drain_stream(stream, session_id, speaker_key, post)
        except Exception:  # noqa: BLE001 - teardown must always complete
            logger.exception("transcriber final drain failed")
        finally:
            await release()
