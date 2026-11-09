import asyncio
import threading
import unittest
import urllib.error

from app.segments import DISCONTINUITY_MS, SegmentStream
from app.streams import (
    DeliveryGate,
    PermanentPostError,
    PreAuthGate,
    SequenceCounter,
    StreamRegistry,
    WindowTimeline,
    base_ms_for_session,
    post_json,
)


class FakeSocket:
    def __init__(self) -> None:
        self.closed: list[int] = []

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed.append(code)


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_new_token_evicts_the_previous_stream_for_the_identity(self):
        registry = StreamRegistry(max_streams=8)
        first = FakeSocket()
        second = FakeSocket()
        acquired, previous = await registry.acquire("s1", "user:1", first)
        self.assertTrue(acquired)
        self.assertIsNone(previous)

        acquired, previous = await registry.acquire("s1", "user:1", second)
        self.assertTrue(acquired)
        self.assertIs(previous, first)
        # The reconnect swaps the same slot and must not be refused with 4429.
        self.assertEqual(registry.by_session["s1"], 1)

        # Releasing the evicted socket must not drop the newer mapping.
        await registry.release("s1", "user:1", first)
        self.assertEqual(registry.by_identity[("s1", "user:1")], second)
        await registry.release("s1", "user:1", second)
        self.assertNotIn(("s1", "user:1"), registry.by_identity)
        self.assertEqual(registry.by_session["s1"], 0)

    async def test_a_reconnect_at_capacity_swaps_without_a_new_slot(self):
        registry = StreamRegistry(max_streams=1)
        first = FakeSocket()
        second = FakeSocket()
        self.assertTrue((await registry.acquire("s1", "user:1", first))[0])
        acquired, previous = await registry.acquire("s1", "user:1", second)
        self.assertTrue(acquired)
        self.assertIs(previous, first)
        self.assertEqual(registry.by_session["s1"], 1)
        # A different identity still cannot enter the full session.
        self.assertFalse((await registry.acquire("s1", "user:2", FakeSocket()))[0])

    async def test_delivery_gate_is_shared_across_a_reconnect(self):
        registry = StreamRegistry()
        gate = await registry.delivery_for("s1", "user:1")
        gate.sequence.value = 7
        again = await registry.delivery_for("s1", "user:1")
        self.assertIs(again, gate)
        self.assertEqual(again.sequence.value, 7)

    async def test_the_delivery_gate_is_evicted_with_the_last_socket(self):
        registry = StreamRegistry()
        old = FakeSocket()
        new = FakeSocket()
        gate = await registry.delivery_for("s1", "user:1")
        self.assertTrue((await registry.acquire("s1", "user:1", old))[0])
        acquired, previous = await registry.acquire("s1", "user:1", new)
        self.assertTrue(acquired)
        self.assertIs(previous, old)
        # The evicted socket releasing must not drop the replacement's gate.
        await registry.release("s1", "user:1", old)
        self.assertIn(("s1", "user:1"), registry.deliveries)
        self.assertIs(await registry.delivery_for("s1", "user:1"), gate)
        # The last socket out evicts it, bounding registry memory.
        await registry.release("s1", "user:1", new)
        self.assertNotIn(("s1", "user:1"), registry.deliveries)
        fresh = await registry.delivery_for("s1", "user:1")
        self.assertIsNot(fresh, gate)
        self.assertEqual(fresh.sequence.value, 0)

    async def test_session_stream_cap_still_applies(self):
        registry = StreamRegistry(max_streams=1)
        self.assertTrue((await registry.acquire("s1", "user:1", FakeSocket()))[0])
        self.assertFalse((await registry.acquire("s1", "user:2", FakeSocket()))[0])


class DeliveryGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_assigns_and_posts_one_batch_at_a_time(self):
        gate = DeliveryGate()
        posted: list[list[dict[str, object]]] = []
        first_started = threading.Event()
        release_first = threading.Event()

        def post(_sid: str, _speaker: str, batch: list[dict[str, object]]) -> bool:
            if not posted:
                first_started.set()
                release_first.wait(5)
            posted.append(batch)
            return True

        first = asyncio.create_task(
            asyncio.to_thread(
                gate.deliver, post, "s1", "user:1", [{"startMs": 0, "endMs": 1000, "text": "one"}]
            )
        )
        await asyncio.to_thread(first_started.wait, 5)
        second = asyncio.create_task(
            asyncio.to_thread(
                gate.deliver,
                post,
                "s1",
                "user:1",
                [{"startMs": 2000, "endMs": 3000, "text": "two"}],
            )
        )
        # The first POST is still in flight, so the second batch waits rather
        # than overtaking it.
        await asyncio.sleep(0.05)
        self.assertEqual(len(posted), 0)
        release_first.set()
        self.assertTrue(await first)
        self.assertTrue(await second)
        self.assertEqual([batch[0]["seq"] for batch in posted], [1, 2])
        self.assertEqual([batch[0]["text"] for batch in posted], ["one", "two"])

    async def test_drops_a_batch_past_the_pending_cap(self):
        gate = DeliveryGate(max_pending=1)
        started = threading.Event()
        release = threading.Event()

        def post(_sid: str, _speaker: str, _batch: list[dict[str, object]]) -> bool:
            started.set()
            release.wait(5)
            return True

        busy = asyncio.create_task(
            asyncio.to_thread(gate.deliver, post, "s1", "user:1", [{"text": "busy"}])
        )
        await asyncio.to_thread(started.wait, 5)
        with self.assertLogs("aulora.transcriber", level="WARNING"):
            dropped = await asyncio.to_thread(
                gate.deliver, post, "s1", "user:1", [{"text": "dropped"}]
            )
        self.assertFalse(dropped)
        release.set()
        self.assertTrue(await busy)


class PreAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_caps_unauthenticated_connections(self):
        gate = PreAuthGate(limit=1)
        self.assertTrue(await gate.begin())
        self.assertFalse(await gate.begin())
        await gate.end()
        self.assertTrue(await gate.begin())


class TimingTests(unittest.TestCase):
    def test_timestamps_are_offsets_from_the_session_start(self):
        self.assertEqual(base_ms_for_session(1_700_000_000_000, 1_700_000_012_500), 12_500)
        # A clock before the session start never yields a negative offset.
        self.assertEqual(base_ms_for_session(1_700_000_010_000, 1_700_000_000_000), 0)


class WindowTimelineTests(unittest.TestCase):
    def test_a_mute_gap_is_not_compressed(self):
        now = [0.0]
        timeline = WindowTimeline(
            base_offset_ms=0,
            opened_at_ms=0,
            clock=lambda: now[0],
        )
        # First 2 s window starts at the session-relative zero.
        timeline.first_frame()
        self.assertEqual(timeline.take_offset(), 0)

        # 30 s pass with no audio, then the next window begins at ~32 s.
        now[0] = 32_000.0
        timeline.first_frame()
        self.assertEqual(timeline.take_offset(), 32_000)

    def test_base_offset_keeps_a_late_join_session_relative(self):
        now = [0.0]
        timeline = WindowTimeline(
            base_offset_ms=5_000,
            opened_at_ms=0,
            clock=lambda: now[0],
        )
        now[0] = 1_500.0
        timeline.first_frame()
        self.assertEqual(timeline.take_offset(), 6_500)


class FakeSegment:
    start_ms = 0
    end_ms = 1000
    text = "word"
    confidence = None
    language = None


class FakeEngine:
    def transcribe(self, _data: bytes):
        return [FakeSegment()]


class SegmentStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_partial_window_is_flushed_before_a_mute_gap(self):
        now = [0.0]
        timeline = WindowTimeline(
            base_offset_ms=0,
            opened_at_ms=0,
            clock=lambda: now[0],
        )
        stream = SegmentStream(
            session_id="s1",
            speaker_key="user:1",
            engine_getter=lambda: FakeEngine(),
            timeline=timeline,
        )
        one_second = 32_000
        # 1 s of audio, then a 30 s mute, then 1 s more.
        self.assertEqual(stream.feed(b"\x00" * one_second), [])
        now[0] = float(31_000)
        batches = stream.feed(b"\x00" * one_second)
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0]["startMs"], 0)
        rest = await stream.flush()
        self.assertEqual(len(rest), 1)
        self.assertEqual(rest[0]["startMs"], 31_000)
        self.assertGreaterEqual(31_000, 30_000 + DISCONTINUITY_MS)


class PostJsonTests(unittest.TestCase):
    def test_retries_failed_ingest_and_reports_failure(self):
        calls: list[int] = []

        def opener(request, timeout=15.0):
            calls.append(1)
            raise urllib.error.URLError("connection refused")

        posted = post_json(
            "http://convex-backend:3211/transcription/ingest",
            {"sessionId": "s1", "segments": []},
            "synthetic-secret",
            attempts=3,
            backoff=0,
            opener=opener,
        )
        self.assertFalse(posted)
        self.assertEqual(len(calls), 3)

    def test_stops_after_the_first_success(self):
        calls: list[int] = []

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        def opener(request, timeout=15.0):
            calls.append(1)
            return Response()

        self.assertTrue(
            post_json(
                "http://example.invalid",
                {"ok": True},
                "synthetic-secret",
                attempts=3,
                opener=opener,
            )
        )
        self.assertEqual(len(calls), 1)


class PermanentRejectionTests(unittest.TestCase):
    def test_a_400_is_permanent_and_attempted_once(self):
        calls: list[int] = []

        def opener(request, timeout=15.0):
            calls.append(1)
            raise urllib.error.HTTPError("http://x", 400, "Bad Request", {}, None)

        with self.assertRaises(PermanentPostError) as raised:
            post_json(
                "http://x",
                {"segments": []},
                "synthetic-secret",
                attempts=3,
                backoff=0,
                opener=opener,
                stop_on_rejection=True,
            )
        self.assertEqual(raised.exception.status, 400)
        self.assertEqual(len(calls), 1)

    def test_a_503_is_still_retried(self):
        calls: list[int] = []

        def opener(request, timeout=15.0):
            calls.append(1)
            raise urllib.error.HTTPError("http://x", 503, "Unavailable", {}, None)

        self.assertFalse(
            post_json(
                "http://x",
                {"segments": []},
                "synthetic-secret",
                attempts=3,
                backoff=0,
                opener=opener,
                stop_on_rejection=True,
            )
        )
        self.assertEqual(len(calls), 3)

    def test_a_408_is_still_retried(self):
        calls: list[int] = []

        def opener(request, timeout=15.0):
            calls.append(1)
            raise urllib.error.HTTPError("http://x", 408, "Timeout", {}, None)

        self.assertFalse(
            post_json(
                "http://x",
                {"segments": []},
                "synthetic-secret",
                attempts=3,
                backoff=0,
                opener=opener,
                stop_on_rejection=True,
            )
        )
        self.assertEqual(len(calls), 3)


class SegmentCounterTests(unittest.TestCase):
    def test_counter_starts_at_zero_and_is_shared(self):
        counter = SequenceCounter()
        self.assertEqual(counter.value, 0)


if __name__ == "__main__":
    unittest.main()
