import json
import unittest
from pathlib import Path

from app.hello import build_hello_payload
from app.models import LoadedModel

FIXTURE = Path(__file__).with_name("fixtures") / "hello-cold-start.json"


class FakeEngine:
    def transcribe(self, _data: bytes):
        return []


class HelloPayloadTests(unittest.TestCase):
    def test_cold_start_omits_absent_optional_fields(self):
        loaded = LoadedModel()
        payload = build_hello_payload(loaded)
        # This is the exact JSON the heartbeat posts before any model exists.
        self.assertEqual(payload, json.loads(FIXTURE.read_text(encoding="utf-8")))
        self.assertNotIn("loadedModelId", payload)
        self.assertNotIn("loadedError", payload)
        self.assertNotIn("downloadActive", payload)
        self.assertNotIn(None, payload.values())

    def test_ready_model_names_the_loaded_model(self):
        loaded = LoadedModel()
        loaded.engine = FakeEngine()
        loaded.model_id = "small"
        loaded.state.ready("small")
        payload = build_hello_payload(loaded)
        self.assertEqual(payload["loadedStatus"], "ready")
        self.assertEqual(payload["loadedModelId"], "small")
        self.assertNotIn("downloadActive", payload)

    def test_downloading_hello_marks_the_download_active(self):
        loaded = LoadedModel()
        loaded.state.start("medium")
        payload = build_hello_payload(loaded)
        self.assertEqual(payload["loadedStatus"], "not_installed")
        self.assertTrue(payload["downloadActive"])
        self.assertNotIn("loadedModelId", payload)
        self.assertNotIn(None, payload.values())

    def test_download_failure_reports_an_error_without_nulls(self):
        loaded = LoadedModel()
        loaded.engine = FakeEngine()
        loaded.model_id = "base"
        loaded.state.ready("base")
        loaded.state.error = "large-v3-turbo failed to download"
        payload = build_hello_payload(loaded)
        self.assertEqual(payload["loadedModelId"], "base")
        self.assertEqual(payload["loadedError"], "large-v3-turbo failed to download")
        self.assertNotIn(None, payload.values())


if __name__ == "__main__":
    unittest.main()
