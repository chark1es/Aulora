import os
import tempfile
import unittest
from pathlib import Path

from app.models import LoadedModel
from app.restore import (
    RESTORE_ORDER,
    read_selected_model,
    record_download_failure,
    remove_legacy_whisper_cache,
    restore_loaded_model,
    write_selected_model,
)


MODEL_ID = "parakeet-tdt-0.6b-v3"


class RestoreTests(unittest.TestCase):
    def test_restores_the_selected_model(self):
        with tempfile.TemporaryDirectory() as models_dir:
            write_selected_model(models_dir, MODEL_ID)
            loaded = LoadedModel()
            tried: list[str] = []

            def loader(model_id: str, _models_dir: str):
                tried.append(model_id)
                return object()

            self.assertEqual(restore_loaded_model(loaded, models_dir, loader), MODEL_ID)
            self.assertEqual(tried, [MODEL_ID])
            self.assertEqual(loaded.state.status, "ready")
            self.assertEqual(read_selected_model(models_dir), MODEL_ID)

    def test_a_legacy_whisper_selection_is_ignored(self):
        with tempfile.TemporaryDirectory() as models_dir:
            Path(models_dir, ".selected").write_text("large-v3-turbo", encoding="utf-8")
            self.assertIsNone(read_selected_model(models_dir))
            loaded = LoadedModel()
            self.assertEqual(
                restore_loaded_model(loaded, models_dir, lambda *_: object()), MODEL_ID
            )
            self.assertEqual(read_selected_model(models_dir), MODEL_ID)

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

    def test_failed_download_keeps_the_loaded_model_ready(self):
        loaded = LoadedModel()
        loaded.engine = object()
        loaded.model_id = MODEL_ID
        loaded.state.ready(MODEL_ID)
        record_download_failure(loaded, MODEL_ID, "oom")
        self.assertEqual(loaded.model_id, MODEL_ID)
        self.assertEqual(loaded.state.status, "ready")
        self.assertEqual(loaded.state.progress, 100)
        self.assertIn(MODEL_ID, loaded.state.error or "")

    def test_restore_order(self):
        self.assertEqual(RESTORE_ORDER, (MODEL_ID,))


class LegacyCleanupTests(unittest.TestCase):
    def make(self, *parts: str) -> str:
        path = os.path.join(*parts)
        os.makedirs(path)
        Path(path, "model.bin").write_bytes(b"x")
        return path

    def test_removes_only_the_exact_legacy_whisper_directories(self):
        with tempfile.TemporaryDirectory() as models_dir:
            hub = os.path.join(models_dir, "hf-cache", "hub")
            legacy = [
                self.make(hub, "models--Systran--faster-whisper-small"),
                self.make(hub, "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"),
                self.make(models_dir, "models--Systran--faster-whisper-tiny"),
                self.make(hub, ".locks", "models--Systran--faster-whisper-base"),
            ]
            keep = [
                self.make(hub, "models--someone--other-model"),
                self.make(hub, "models--Systran--faster-distil-whisper-small"),
                self.make(models_dir, MODEL_ID),
                self.make(models_dir, "hf-cache", "xet"),
            ]
            removed = remove_legacy_whisper_cache(models_dir)
            self.assertEqual(sorted(removed), sorted(legacy))
            for path in legacy:
                self.assertFalse(os.path.exists(path))
            for path in keep:
                self.assertTrue(os.path.exists(path))

    def test_missing_directories_and_symlinks_are_left_alone(self):
        with tempfile.TemporaryDirectory() as models_dir, tempfile.TemporaryDirectory() as other:
            self.assertEqual(remove_legacy_whisper_cache(models_dir), [])
            target = self.make(other, "precious")
            os.symlink(target, os.path.join(models_dir, "models--Systran--faster-whisper-tiny"))
            self.assertEqual(remove_legacy_whisper_cache(models_dir), [])
            self.assertTrue(os.path.exists(os.path.join(target, "model.bin")))

    def test_errors_are_logged_and_cleanup_continues(self):
        with tempfile.TemporaryDirectory() as models_dir:
            first = self.make(models_dir, "models--Systran--faster-whisper-tiny")
            second = self.make(models_dir, "models--Systran--faster-whisper-base")
            real = __import__("shutil").rmtree

            def flaky(path, *args, **kwargs):
                if path == first:
                    raise OSError("read-only")
                return real(path, *args, **kwargs)

            from unittest.mock import patch

            with patch("app.restore.shutil.rmtree", flaky), self.assertLogs(
                "aulora.transcriber", level="WARNING"
            ):
                removed = remove_legacy_whisper_cache(models_dir)
            self.assertEqual(removed, [second])
            self.assertTrue(os.path.exists(first))


if __name__ == "__main__":
    unittest.main()
