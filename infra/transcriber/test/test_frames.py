import unittest

from app.frames import MAX_FRAME_BYTES, SAMPLE_RATE_HZ, validate_frame


class FrameTests(unittest.TestCase):
    def test_accepts_even_pcm16_frames_within_the_cap(self):
        self.assertIsNone(validate_frame(b"\x00\x00" * 160))
        self.assertIsNone(validate_frame(b"\x00\x00" * (MAX_FRAME_BYTES // 2)))

    def test_rejects_empty_odd_and_oversized_frames(self):
        self.assertEqual(validate_frame(b""), "empty_frame")
        self.assertEqual(validate_frame(b"\x00"), "odd_frame_length")
        self.assertEqual(
            validate_frame(b"\x00\x00" * (MAX_FRAME_BYTES // 2 + 1)), "frame_too_large"
        )

    def test_wire_format_is_16khz(self):
        self.assertEqual(SAMPLE_RATE_HZ, 16_000)


if __name__ == "__main__":
    unittest.main()
