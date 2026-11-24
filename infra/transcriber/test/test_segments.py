"""Utterance-aware windowing with a fake engine and a fake clock."""

import struct
import unittest
from array import array

from app.segments import DISCONTINUITY_MS, SegmentStream
from app.streams import WindowTimeline

FRAME = 3200  # 100 ms of 16 kHz PCM16


def tone(ms: int, amplitude: int = 3000) -> bytes:
    return struct.pack("<h", amplitude) * (16 * ms)


def quiet(ms: int) -> bytes:
    return struct.pack("<h", 5) * (16 * ms)


class Segment:
    def __init__(self, start_ms: int, end_ms: int) -> None:
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.text = "word"
        self.confidence = None
        self.language = None


class RecordingEngine:
    def __init__(self) -> None:
        self.windows: list[bytes] = []

    def transcribe(self, data: bytes):
        self.windows.append(data)
        return [Segment(0, 100)]


def make_stream(engine, clock=None):
    now = clock if clock is not None else [0.0]
    return SegmentStream(
        session_id="s1",
        speaker_key="user:1",
        engine_getter=lambda: engine,
        timeline=WindowTimeline(base_offset_ms=0, opened_at_ms=0, clock=lambda: now[0]),
    )


def feed_frames(stream, audio: bytes) -> list[dict[str, object]]:
    batches: list[dict[str, object]] = []
    for start in range(0, len(audio), FRAME):
        batches.extend(stream.feed(audio[start : start + FRAME]))
    return batches


class PauseCutTests(unittest.IsolatedAsyncioTestCase):
    async def test_continuous_speech_is_not_cut_before_a_pause(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        self.assertEqual(feed_frames(stream, tone(8_000)), [])
        self.assertEqual(engine.windows, [])

    async def test_a_pause_after_the_minimum_ends_the_window_once(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        # 2.5 s of speech runs past the old 2 s cut without being split.
        self.assertEqual(feed_frames(stream, tone(2_500)), [])
        batches = feed_frames(stream, quiet(500))
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(engine.windows), 1)
        self.assertEqual(len(engine.windows[0]), 16 * 3_000 * 2)
        self.assertEqual(batches[0]["startMs"], 0)
        self.assertEqual(len(stream.buffer), 0)

    async def test_a_pause_before_the_minimum_does_not_cut(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        self.assertEqual(feed_frames(stream, tone(800) + quiet(600)), [])
        self.assertEqual(engine.windows, [])

    async def test_a_quiet_speaker_still_pauses(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        feed_frames(stream, tone(2_200, amplitude=300))
        batches = feed_frames(stream, quiet(500))
        self.assertEqual(len(batches), 1)

    async def test_a_new_utterance_starts_on_its_own_timeline_offset(self):
        now = [0.0]
        stream = make_stream(RecordingEngine(), now)
        now[0] = 2_000.0
        feed_frames(stream, tone(2_000))
        first = feed_frames(stream, quiet(500))
        self.assertEqual(first[0]["startMs"], 2_000)
        # Frames arrive in real time, so the next utterance starts later.
        now[0] = 2_600.0
        feed_frames(stream, tone(2_000))
        second = feed_frames(stream, quiet(500))
        self.assertEqual(second[0]["startMs"], 2_600)


class ForcedCutTests(unittest.TestCase):
    def test_a_forced_cut_lands_in_the_quietest_frame_and_carries_the_rest(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        # 18.9 s of speech, a 100 ms dip, then 1.2 s more speech: no pause is long
        # enough, so the window is forced at the 20 s maximum.
        audio = tone(18_900) + quiet(100) + tone(1_200)
        batches = feed_frames(stream, audio)
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(engine.windows), 1)
        window = engine.windows[0]
        # The cut is in the middle of the quiet frame at 18.9 s..19.0 s.
        self.assertEqual(len(window), 16 * 18_950 * 2)
        # The remainder (the second half of that frame plus 1.2 s) is carried.
        carried_ms = (len(audio) - len(window)) // 32
        self.assertEqual(len(stream.buffer) // 32, carried_ms)
        self.assertEqual(carried_ms, 20_200 - 18_950)
        # Timeline: the carried audio starts exactly where the window ended.
        self.assertEqual(stream.timeline.window_started_offset_ms, 18_950)

    def test_carried_audio_is_reported_at_its_own_offset(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        audio = tone(18_900) + quiet(100) + tone(1_000)
        feed_frames(stream, audio)
        self.assertEqual(len(engine.windows), 1)
        # A pause then flushes the carried remainder at 18_950 ms.
        batches = feed_frames(stream, quiet(2_000))
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0]["startMs"], 18_950)

    def test_forced_cut_with_no_quiet_frame_still_makes_progress(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        batches = feed_frames(stream, tone(20_000))
        self.assertEqual(len(batches), 1)
        self.assertLessEqual(len(engine.windows[0]), 16 * 20_000 * 2)
        self.assertLess(len(stream.buffer), 16 * 20_000 * 2)


class SilenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_an_entirely_silent_window_never_reaches_the_engine(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        silence = b"\x00" * (FRAME * 30)
        self.assertEqual(feed_frames(stream, silence), [])
        self.assertEqual(engine.windows, [])
        self.assertEqual(await stream.drain(), [])
        # The skipped window freed the buffer, so speech starts fresh.
        self.assertEqual(len(stream.buffer), 0)

    async def test_near_silent_noise_below_the_floor_is_skipped(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        feed_frames(stream, quiet(5_000))
        self.assertEqual(await stream.drain(), [])
        self.assertEqual(engine.windows, [])


class DrainAndDiscontinuityTests(unittest.IsolatedAsyncioTestCase):
    async def test_drain_flushes_partial_audio_exactly_once(self):
        engine = RecordingEngine()
        stream = make_stream(engine)
        feed_frames(stream, tone(700))
        first = await stream.drain()
        second = await stream.drain()
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(len(engine.windows), 1)

    async def test_drain_with_no_engine_discards_the_audio(self):
        stream = make_stream(None)
        feed_frames(stream, tone(700))
        self.assertEqual(await stream.drain(), [])
        self.assertEqual(len(stream.buffer), 0)

    async def test_a_gap_flushes_the_partial_window_at_its_own_offset(self):
        now = [0.0]
        engine = RecordingEngine()
        stream = make_stream(engine, now)
        feed_frames(stream, tone(1_000))
        now[0] = 31_000.0
        batches = stream.feed(tone(100))
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0]["startMs"], 0)
        rest = await stream.drain()
        self.assertEqual(rest[0]["startMs"], 31_000)
        self.assertGreaterEqual(31_000, DISCONTINUITY_MS)

    async def test_the_carried_remainder_is_flushed_by_a_gap_at_the_right_offset(self):
        now = [0.0]
        engine = RecordingEngine()
        stream = make_stream(engine, now)
        feed_frames(stream, tone(18_900) + quiet(100) + tone(1_000))
        self.assertEqual(len(engine.windows), 1)
        now[0] = 60_000.0
        batches = stream.feed(tone(100))
        self.assertEqual(batches[0]["startMs"], 18_950)


class WindowTimelineSplitTests(unittest.TestCase):
    def test_split_offset_keeps_the_remainder_aligned(self):
        now = [1_000.0]
        timeline = WindowTimeline(base_offset_ms=500, opened_at_ms=0, clock=lambda: now[0])
        timeline.first_frame()
        self.assertEqual(timeline.split_offset(4_000), 1_500)
        # The wall clock moving on does not disturb the carried start.
        now[0] = 9_000.0
        timeline.first_frame()
        self.assertEqual(timeline.take_offset(), 5_500)
        # After a full take, the next window starts from the clock again.
        timeline.first_frame()
        self.assertEqual(timeline.take_offset(), 9_500)


class EnergyHelperTests(unittest.TestCase):
    def test_frame_rms_of_a_constant_signal(self):
        from app.segments import frame_rms

        self.assertAlmostEqual(frame_rms(struct.pack("<h", -1000) * 100), 1000.0)
        self.assertEqual(frame_rms(b""), 0.0)
        samples = array("h", [3, 4])
        self.assertAlmostEqual(frame_rms(samples.tobytes()), (12.5) ** 0.5)


if __name__ == "__main__":
    unittest.main()
