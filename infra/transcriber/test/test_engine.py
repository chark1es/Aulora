import sys
import types
import unittest
from unittest.mock import Mock, patch

from app.engine import load_engine


class ModelDownloadTests(unittest.TestCase):
    def test_startup_loading_only_uses_cached_files(self):
        whisper = Mock()
        with patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=whisper)}):
            load_engine("tiny", "/synthetic/models")
        self.assertTrue(whisper.call_args.kwargs["local_files_only"])

    def test_an_explicit_download_can_fetch_a_model(self):
        whisper = Mock()
        with patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=whisper)}):
            load_engine("tiny", "/synthetic/models", allow_download=True)
        self.assertFalse(whisper.call_args.kwargs["local_files_only"])
