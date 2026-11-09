"""Teardown drains, driven through the real stream loop.

FastAPI is not installed in the normal test environment, so the loop lives in
``app.session`` (no server imports) and is exercised directly. A handler-level
test is included and skipped only when FastAPI is genuinely unavailable.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import unittest
from typing import Any

from app.protocol import CLOSE_SESSION_ENDED
from app.segments import SegmentStream
from app.session import serve_stream
from app.streams import DeliveryGate, PermanentPostError, StreamRegistry, WindowTimeline


class FakeSegment:
    start_ms = 0
    end_ms = 1000
    text = "word"
    confidence = None
    language = None


class FakeEngine:
    def transcribe(self, _data: bytes):
        return [FakeSegment()]


class FakeDisconnect(Exception):
    pass


class ScriptedWebSocket:
    """Returns each scripted message, then raises a disconnect."""

    def __init__(self, messages: list[dict[str, Any]], *, idle: bool = False) -> None:
        self.messages = list(messages)
        self.idle = idle
        self.closed: tuple[int, str] | None = None
        self.sent: list[dict[str, Any]] = []

    async def receive(self) -> dict[str, Any]:
        if self.messages:
            return self.messages.pop(0)
        if self.idle:
            raise TimeoutError
        raise FakeDisconnect("gone")

    async def accept(self) -> None:
        return None

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)


class BlockingWebSocket(ScriptedWebSocket):
    """Blocks in ``receive`` until a replacement closes it."""

    def __init__(self) -> None:
        super().__init__([])
        self.gate = asyncio.Event()
        self.entered = asyncio.Event()

    async def receive(self) -> dict[str, Any]:
        self.entered.set()
        await self.gate.wait()
        return {"type": "websocket.disconnect"}

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)
        self.gate.set()


class TextSegment:
    def __init__(self, text: str) -> None:
        self.start_ms = 0
        self.end_ms = 1000
        self.text = text
        self.confidence = None
        self.language = None


class TextEngine:
    def __init__(self, text: str) -> None:
        self.text = text

    def transcribe(self, _data: bytes):
        return [TextSegment(self.text)]


def make_stream(engine: Any | None = None) -> SegmentStream:
    return SegmentStream(
        session_id="s1",
        speaker_key="user:1",
        engine_getter=(lambda: engine) if engine is not None else (lambda: FakeEngine()),
        timeline=WindowTimeline(base_offset_ms=0, opened_at_ms=0, clock=lambda: 0.0),
    )


def make_delivery(gate: DeliveryGate, post):
    def deliver(sid: str, speaker: str, batch: list[dict[str, object]]) -> bool:
        return gate.deliver(post, sid, speaker, batch)

    return deliver


class TeardownDrainTests(unittest.IsolatedAsyncioTestCase):
    async def run_stream(
        self,
        websocket: ScriptedWebSocket,
        stream: SegmentStream,
        *,
        idle_timeout: float = 1.0,
    ) -> tuple[list[list[dict[str, object]]], list[str]]:
        posted: list[list[dict[str, object]]] = []
        released: list[str] = []

        def post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            posted.append(batch)
            return True

        async def release() -> None:
            released.append("released")

        await serve_stream(
            websocket,
            stream,
            session_id="s1",
            speaker_key="user:1",
            post=make_delivery(DeliveryGate(), post),
            release=release,
            disconnect_errors=(FakeDisconnect,),
            idle_timeout=idle_timeout,
        )
        return posted, released

    async def test_disconnect_drains_one_second_of_audio(self):
        stream = make_stream()
        ws = ScriptedWebSocket([{"bytes": b"\x00" * 16_000}, {"bytes": b"\x00" * 16_000}])
        posted, released = await self.run_stream(ws, stream)
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0][0]["seq"], 1)
        self.assertEqual(posted[0][0]["startMs"], 0)
        self.assertEqual(released, ["released"])

    async def test_explicit_end_drains_once_and_does_not_double_send(self):
        stream = make_stream()
        ws = ScriptedWebSocket(
            [
                {"bytes": b"\x00" * 16_000},
                {"bytes": b"\x00" * 16_000},
                {"text": json.dumps({"type": "end"})},
            ]
        )
        posted, _ = await self.run_stream(ws, stream)
        self.assertEqual(len(posted), 1)
        self.assertEqual(ws.closed, (1000, "ended"))

    async def test_idle_timeout_drains_one_second_of_audio(self):
        stream = make_stream()
        ws = ScriptedWebSocket(
            [{"bytes": b"\x00" * 16_000}, {"bytes": b"\x00" * 16_000}], idle=True
        )
        posted, _ = await self.run_stream(ws, stream, idle_timeout=0.01)
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0][0]["seq"], 1)

    async def test_drain_failure_still_releases_and_does_not_raise(self):
        class FailingEngine:
            def transcribe(self, _data: bytes):
                raise RuntimeError("engine exploded")

        stream = SegmentStream(
            session_id="s1",
            speaker_key="user:1",
            engine_getter=lambda: FailingEngine(),
            timeline=WindowTimeline(base_offset_ms=0, opened_at_ms=0, clock=lambda: 0.0),
        )
        ws = ScriptedWebSocket(
            [{"bytes": b"\x00" * 16_000}, {"bytes": b"\x00" * 16_000}]
        )
        released: list[str] = []

        async def release() -> None:
            released.append("released")

        with self.assertLogs("aulora.transcriber", level="ERROR"):
            await serve_stream(
                ws,
                stream,
                session_id="s1",
                speaker_key="user:1",
                post=lambda _sid, _speaker, _batch: True,
                release=release,
                disconnect_errors=(FakeDisconnect,),
                idle_timeout=1.0,
            )
        self.assertEqual(released, ["released"])

    async def test_empty_buffer_posts_nothing(self):
        stream = make_stream()
        ws = ScriptedWebSocket([])
        posted, released = await self.run_stream(ws, stream)
        self.assertEqual(posted, [])
        self.assertEqual(released, ["released"])

    async def test_replacement_eviction_drains_then_replacement_continues_sequence(self):
        registry = StreamRegistry()
        sid, sub = "s1", "user:1"
        old_ws = BlockingWebSocket()
        acquired, previous = await registry.acquire(sid, sub, old_ws)
        self.assertTrue(acquired)
        self.assertIsNone(previous)
        gate = await registry.delivery_for(sid, sub)
        old_stream = make_stream()
        old_stream.feed(b"\x00" * 32_000)
        posted: list[list[dict[str, object]]] = []

        def post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            posted.append(batch)
            return True

        deliver = make_delivery(gate, post)

        old_task = asyncio.create_task(
            serve_stream(
                old_ws,
                old_stream,
                session_id=sid,
                speaker_key=sub,
                post=deliver,
                release=lambda: registry.release(sid, sub, old_ws),
                disconnect_errors=(FakeDisconnect,),
                idle_timeout=1.0,
            )
        )
        await old_ws.entered.wait()

        new_ws = ScriptedWebSocket(
            [
                {"bytes": b"\x00" * 16_000},
                {"bytes": b"\x00" * 16_000},
                {"bytes": b"\x00" * 16_000},
                {"bytes": b"\x00" * 16_000},
                {"text": json.dumps({"type": "end"})},
            ]
        )
        acquired, previous = await registry.acquire(sid, sub, new_ws)
        self.assertTrue(acquired)
        self.assertIs(previous, old_ws)
        # A replacement closes the old socket; its handler drains before it
        # releases, and the shared sequence counter continues at 2.
        await previous.close(code=1000, reason="replaced")
        await old_task

        new_stream = make_stream()
        await serve_stream(
            new_ws,
            new_stream,
            session_id=sid,
            speaker_key=sub,
            post=deliver,
            release=lambda: registry.release(sid, sub, new_ws),
            disconnect_errors=(FakeDisconnect,),
            idle_timeout=1.0,
        )
        self.assertEqual([batch[0]["seq"] for batch in posted], [1, 2])


class DeliveryOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def test_delayed_old_drain_does_not_let_the_replacement_overtake(self):
        """One delivery order per identity across a socket replacement.

        The evicted socket's teardown drain reaches the network first but its
        POST is delayed. The replacement's first batch must wait behind it, so
        Convex receives seq 1 then seq 2 and every segment lands. Without the
        shared delivery gate the replacement would post seq 2 first and Convex
        would reject the late seq 1 as a replay.
        """
        registry = StreamRegistry()
        sid, sub = "s1", "user:1"
        gate = await registry.delivery_for(sid, sub)
        posted: list[list[dict[str, object]]] = []
        old_post_started = threading.Event()
        release_old = threading.Event()
        held = {"once": False}

        def post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            if not held["once"]:
                # Hold only the first POST, which is the evicted socket's drain.
                held["once"] = True
                old_post_started.set()
                release_old.wait(5)
            posted.append(batch)
            return True

        deliver = make_delivery(gate, post)
        old_ws = BlockingWebSocket()
        acquired, previous = await registry.acquire(sid, sub, old_ws)
        self.assertTrue(acquired)
        self.assertIsNone(previous)
        old_stream = make_stream(TextEngine("old drain"))
        old_stream.feed(b"\x00" * 32_000)
        old_task = asyncio.create_task(
            serve_stream(
                old_ws,
                old_stream,
                session_id=sid,
                speaker_key=sub,
                post=deliver,
                release=lambda: registry.release(sid, sub, old_ws),
                disconnect_errors=(FakeDisconnect,),
                idle_timeout=1.0,
            )
        )
        await old_ws.entered.wait()
        # The evicted socket drains and enters its POST, which the fake network
        # holds open.
        await old_ws.close(code=1000, reason="replaced")
        await asyncio.to_thread(old_post_started.wait, 5)
        self.assertEqual(posted, [])

        new_ws = ScriptedWebSocket(
            [
                {"bytes": b"\x00" * 16_000},
                {"bytes": b"\x00" * 16_000},
                {"text": json.dumps({"type": "end"})},
            ]
        )
        new_stream = make_stream(TextEngine("replacement"))
        replacement = asyncio.create_task(
            serve_stream(
                new_ws,
                new_stream,
                session_id=sid,
                speaker_key=sub,
                post=deliver,
                release=lambda: registry.release(sid, sub, new_ws),
                disconnect_errors=(FakeDisconnect,),
                idle_timeout=1.0,
            )
        )
        # Head-of-line blocking: the replacement may not post until seq 1 has
        # been delivered, even though its own audio is already transcribed.
        await asyncio.sleep(0.05)
        self.assertEqual(posted, [])

        release_old.set()
        await old_task
        await replacement
        self.assertEqual([batch[0]["seq"] for batch in posted], [1, 2])
        self.assertEqual([batch[0]["text"] for batch in posted], ["old drain", "replacement"])


class PermanentRejectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_400_closes_terminal_and_releases_the_gate(self):
        gate = DeliveryGate()
        attempts: list[int] = []

        def post(_sid: str, _speaker: str, _batch: list[dict[str, object]]) -> bool:
            attempts.append(1)
            raise PermanentPostError(400)

        # Four 16 KiB frames fill one 2 s window, so the POST happens in the
        # main loop rather than in a teardown drain.
        ws = ScriptedWebSocket([{"bytes": b"\x00" * 16_000} for _ in range(4)])
        with self.assertLogs("aulora.transcriber", level="WARNING"):
            await serve_stream(
                ws,
                make_stream(),
                session_id="s1",
                speaker_key="user:1",
                post=make_delivery(gate, post),
                release=lambda: asyncio.sleep(0),
                disconnect_errors=(FakeDisconnect,),
                idle_timeout=1.0,
            )
        self.assertEqual(ws.closed, (CLOSE_SESSION_ENDED, "session ended"))
        # No retry and no second drain POST for a permanent rejection.
        self.assertEqual(len(attempts), 1)
        # The gate is not left blocked for later batches.
        self.assertTrue(gate.deliver(lambda *_: True, "s1", "user:1", [{"text": "later"}]))


try:
    from fastapi import FastAPI as _FastAPI  # noqa: F401
    import app.main as _main  # noqa: F401

    HAVE_FASTAPI = True
except Exception:  # noqa: BLE001 - the optional server stack is absent
    HAVE_FASTAPI = False


@unittest.skipUnless(HAVE_FASTAPI, "FastAPI is not installed in this environment")
class HandlerTeardownTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_handler_drains_on_disconnect(self):
        import app.main as main
        from app.tokens import sign_claims

        secret = "handler-test-secret"
        main.SECRET = secret
        main.loaded.engine = FakeEngine()
        main.loaded.state.ready("base")
        main.registry = StreamRegistry()
        posted: list[list[dict[str, object]]] = []

        def fake_post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            posted.append(batch)
            return True

        original = main.post_segments
        main.post_segments = fake_post
        try:
            token = sign_claims(
                secret,
                sid="s1",
                cid="c1",
                sub="user:1",
                exp=int(time.time()) + 60,
                start=int(time.time() * 1000),
            )
            ws = ScriptedWebSocket(
                [
                    {"bytes": b"\x00" * 16_000},
                    {"bytes": b"\x00" * 16_000},
                    {"type": "websocket.disconnect"},
                ]
            )

            async def receive_text() -> str:
                return json.dumps({"type": "auth", "token": token})

            ws.receive_text = receive_text  # type: ignore[attr-defined]
            await main.transcribe(ws)
        finally:
            main.post_segments = original
        self.assertEqual(len(posted), 1)

    async def test_replacement_uses_close_4410_and_second_continues(self):
        import app.main as main
        from app.protocol import CLOSE_REPLACED
        from app.tokens import sign_claims

        secret = "handler-test-secret"
        main.SECRET = secret
        main.loaded.engine = FakeEngine()
        main.loaded.state.ready("base")
        main.registry = StreamRegistry()
        posted: list[list[dict[str, object]]] = []

        def fake_post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            posted.append(batch)
            return True

        token = sign_claims(
            secret,
            sid="s-replace",
            cid="c1",
            sub="user:1",
            exp=int(time.time()) + 60,
            start=int(time.time() * 1000),
        )

        def wire_auth(ws: ScriptedWebSocket) -> None:
            async def receive_text() -> str:
                return json.dumps({"type": "auth", "token": token})

            ws.receive_text = receive_text  # type: ignore[attr-defined]

        original = main.post_segments
        main.post_segments = fake_post
        try:
            first = BlockingWebSocket()
            wire_auth(first)
            first_task = asyncio.create_task(main.transcribe(first))
            await first.entered.wait()

            second = ScriptedWebSocket(
                [
                    {"bytes": b"\x00" * 16_000},
                    {"bytes": b"\x00" * 16_000},
                    {"type": "websocket.disconnect"},
                ]
            )
            wire_auth(second)
            await main.transcribe(second)
            await first_task
        finally:
            main.post_segments = original

        self.assertEqual(first.closed, (CLOSE_REPLACED, "replaced by a newer connection"))
        self.assertEqual(second.sent[0]["type"], "ready")
        self.assertEqual(len(posted), 1)


if __name__ == "__main__":
    unittest.main()
