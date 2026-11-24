import os
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.engine import MODEL_FILES, load_engine, split_sentences

MODEL_ID = "parakeet-tdt-0.6b-v3"


def make_model_dir(models_dir: str, files: tuple[str, ...] = MODEL_FILES) -> str:
    directory = os.path.join(models_dir, MODEL_ID)
    os.makedirs(directory)
    for name in files:
        with open(os.path.join(directory, name), "wb") as handle:
            handle.write(b"synthetic")
    return directory


class ModelLoadingTests(unittest.TestCase):
    def test_startup_loading_never_downloads_and_needs_every_file(self):
        onnx_asr = Mock()
        hub = Mock()
        modules = {"onnx_asr": onnx_asr, "huggingface_hub": hub}
        with tempfile.TemporaryDirectory() as models_dir, patch.dict(sys.modules, modules):
            with self.assertRaises(FileNotFoundError):
                load_engine(MODEL_ID, models_dir)
            make_model_dir(models_dir, MODEL_FILES[:-1])
            with self.assertRaises(FileNotFoundError):
                load_engine(MODEL_ID, models_dir)
        onnx_asr.load_model.assert_not_called()
        hub.snapshot_download.assert_not_called()

    def test_complete_model_dir_is_loaded_offline_as_int8(self):
        onnx_asr = Mock()
        modules = {"onnx_asr": onnx_asr}
        with tempfile.TemporaryDirectory() as models_dir, patch.dict(sys.modules, modules):
            directory = make_model_dir(models_dir)
            load_engine(MODEL_ID, models_dir)
        args = onnx_asr.load_model.call_args
        self.assertEqual(args.args[0], "nemo-parakeet-tdt-0.6b-v3")
        self.assertEqual(args.kwargs["path"], directory)
        self.assertEqual(args.kwargs["quantization"], "int8")

    def test_an_explicit_download_fetches_only_the_pinned_int8_files(self):
        onnx_asr = Mock()
        hub = Mock()

        def fake_download(**kwargs):
            make_model_dir(os.path.dirname(kwargs["local_dir"]))

        hub.snapshot_download.side_effect = fake_download
        modules = {"onnx_asr": onnx_asr, "huggingface_hub": hub}
        with tempfile.TemporaryDirectory() as models_dir, patch.dict(sys.modules, modules):
            load_engine(MODEL_ID, models_dir, allow_download=True)
        kwargs = hub.snapshot_download.call_args.kwargs
        self.assertEqual(kwargs["repo_id"], "istupakov/parakeet-tdt-0.6b-v3-onnx")
        self.assertEqual(kwargs["revision"], "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce")
        self.assertEqual(kwargs["allow_patterns"], list(MODEL_FILES))
        onnx_asr.load_model.assert_called_once()

    def test_unknown_model_ids_are_rejected(self):
        with self.assertRaises(ValueError):
            load_engine("tiny", "/synthetic/models")


def result(tokens, timestamps, logprobs=None, text=None):
    return SimpleNamespace(
        text=text if text is not None else "".join(tokens),
        tokens=tokens,
        timestamps=timestamps,
        logprobs=logprobs,
    )


class SplitSentencesTests(unittest.TestCase):
    def test_breaks_after_sentence_punctuation(self):
        tokens = [" Hello", " there", ".", " How", " are", " you", "?", " Fine", "!"]
        stamps = [0.2, 0.5, 0.8, 1.5, 1.7, 1.9, 2.1, 2.8, 3.0]
        segments = split_sentences(result(tokens, stamps), 4000)
        self.assertEqual([s.text for s in segments], ["Hello there.", "How are you?", "Fine!"])
        self.assertEqual((segments[0].start_ms, segments[0].end_ms), (200, 900))
        self.assertEqual((segments[1].start_ms, segments[1].end_ms), (1500, 2200))
        self.assertIsNone(segments[0].language)
        self.assertIsNone(segments[0].confidence)

    def test_a_decimal_point_inside_a_word_is_not_a_sentence_end(self):
        tokens = [" It", " is", " 3.", "5", " percent", "."]
        stamps = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
        segments = split_sentences(result(tokens, stamps), 2000)
        self.assertEqual([s.text for s in segments], ["It is 3.5 percent."])

    def test_a_long_sentence_is_split_at_a_word_boundary(self):
        tokens = [" word"] * 40
        stamps = [i * 0.5 for i in range(40)]
        segments = split_sentences(result(tokens, stamps), 30_000)
        self.assertGreater(len(segments), 1)
        for segment in segments:
            self.assertLessEqual(segment.end_ms - segment.start_ms, 15_600)
        self.assertEqual(sum(s.text.count("word") for s in segments), 40)

    def test_end_is_clamped_to_the_audio_length(self):
        segments = split_sentences(result([" Hi", "."], [0.0, 1.95]), 2000)
        self.assertEqual(segments[0].end_ms, 2000)

    def test_confidence_is_the_mean_token_probability(self):
        import math

        tokens = [" Yes", "."]
        segments = split_sentences(
            result(tokens, [0.0, 0.3], logprobs=[math.log(0.5), math.log(1.0)]), 1000
        )
        self.assertAlmostEqual(segments[0].confidence or 0.0, 0.75)

    def test_missing_timestamps_give_one_segment_for_the_window(self):
        segments = split_sentences(
            SimpleNamespace(text=" Hello. World. ", tokens=None, timestamps=None, logprobs=None),
            3000,
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual((segments[0].start_ms, segments[0].end_ms), (0, 3000))
        self.assertEqual(segments[0].text, "Hello. World.")

    def test_empty_text_is_dropped_and_short_text_is_kept(self):
        self.assertEqual(split_sentences(result([], [], text="  "), 1000), [])
        short = split_sentences(result([" no"], [0.0]), 1000)
        self.assertEqual([s.text for s in short], ["no"])


if __name__ == "__main__":
    unittest.main()
