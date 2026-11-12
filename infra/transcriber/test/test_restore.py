import tempfile
import unittest
from pathlib import Path

from app.models import LoadedModel
from app.restore import (
    RESTORE_ORDER,
    read_selected_model,
    record_download_failure,
    restore_loaded_model,
    write_selected_model,
)


class RestoreTests(unittest.TestCase):
    def test_restores_the_selected_model_even_when_a_larger_one_is_cached(self):
        with tempfile.TemporaryDirectory() as models_dir:
            write_selected_model(models_dir, "small")
            loaded = LoadedModel()
            tried: list[str] = []

            def loader(model_id: str, _models_dir: str):
                tried.append(model_id)
                if model_id in {"small", "large-v3-turbo"}:
                    return object()
                raise FileNotFoundError(model_id)

            restored = restore_loaded_model(loaded, models_dir, loader)
            self.assertEqual(restored, "small")
            self.assertEqual(tried, ["small"])
            self.assertEqual(loaded.model_id, "small")
            self.assertEqual(loaded.state.status, "ready")
            self.assertEqual(read_selected_model(models_dir), "small")

    def test_no_selected_file_restores_the_smallest_cached_model(self):
        with tempfile.TemporaryDirectory() as models_dir:
            loaded = LoadedModel()

            def loader(model_id: str, _models_dir: str):
                if model_id in {"base", "medium"}:
                    return object()
                raise FileNotFoundError(model_id)

            self.assertEqual(restore_loaded_model(loaded, models_dir, loader), "base")
            self.assertEqual(loaded.state.status, "ready")
            # The restored choice is persisted for the next restart.
            self.assertEqual(read_selected_model(models_dir), "base")

    def test_missing_cache_stays_not_installed(self):
        with tempfile.TemporaryDirectory() as models_dir:
            loaded = LoadedModel()

            def loader(_model_id: str, _models_dir: str):
                raise FileNotFoundError("no cache")

            self.assertIsNone(restore_loaded_model(loaded, models_dir, loader))
            self.assertIsNone(loaded.model_id)
            self.assertIsNone(loaded.engine)
            self.assertEqual(loaded.state.status, "not_installed")
            self.assertIsNone(loaded.state.progress)

    def test_failed_download_of_b_keeps_a_ready(self):
        loaded = LoadedModel()
        loaded.engine = object()
        loaded.model_id = "base"
        loaded.state.ready("base")
        record_download_failure(loaded, "large-v3-turbo", "oom")
        self.assertEqual(loaded.model_id, "base")
        self.assertEqual(loaded.state.status, "ready")
        self.assertEqual(loaded.state.progress, 100)
        self.assertIn("large-v3-turbo", loaded.state.error or "")

    def test_smallest_first_order(self):
        self.assertEqual(RESTORE_ORDER, ("tiny", "base", "small", "medium", "large-v3-turbo"))


if __name__ == "__main__":
    unittest.main()
