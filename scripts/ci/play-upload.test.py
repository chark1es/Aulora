"""Unit tests for play-upload.py.

Run with: python3 scripts/ci/play-upload.test.py

The script imports the Google client libraries lazily, so these tests mock the
Play edit lifecycle without installing google-api-python-client.
"""

import importlib.util
import os
import pathlib
import sys
import types
import unittest
from unittest import mock

_MODULE_PATH = pathlib.Path(__file__).with_name("play-upload.py")
_spec = importlib.util.spec_from_file_location("play_upload", _MODULE_PATH)
play_upload = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(play_upload)


def fake_service(version_code=42):
    service = mock.MagicMock()
    edits = service.edits.return_value
    edits.insert.return_value.execute.return_value = {"id": "edit-1"}
    edits.bundles.return_value.upload.return_value.execute.return_value = {
        "versionCode": version_code
    }
    edits.tracks.return_value.update.return_value.execute.return_value = {}
    edits.commit.return_value.execute.return_value = {}
    return service


class UploadTests(unittest.TestCase):
    def test_commits_the_edit_and_assigns_the_track(self):
        service = fake_service()
        media = mock.MagicMock(return_value="MEDIA")

        code = play_upload.upload(service, "dev.spwnd.aulora", "alpha", "a.aab", "notes", media)

        self.assertEqual(code, "42")
        edits = service.edits.return_value
        media.assert_called_once_with("a.aab")
        edits.bundles.return_value.upload.assert_called_once_with(
            packageName="dev.spwnd.aulora", editId="edit-1", media_body="MEDIA"
        )
        edits.tracks.return_value.update.assert_called_once_with(
            packageName="dev.spwnd.aulora",
            editId="edit-1",
            track="alpha",
            body={
                "releases": [
                    {
                        "status": "completed",
                        "versionCodes": ["42"],
                        "releaseNotes": [{"language": "en-US", "text": "notes"}],
                    }
                ]
            },
        )
        edits.commit.assert_called_once_with(packageName="dev.spwnd.aulora", editId="edit-1")
        edits.commit.return_value.execute.assert_called_once_with(
            num_retries=play_upload.RETRIES
        )
        edits.delete.assert_not_called()

    def test_omits_release_notes_when_empty(self):
        service = fake_service()
        play_upload.upload(service, "dev.spwnd.aulora", "internal", "a.aab", "", mock.MagicMock())
        body = service.edits.return_value.tracks.return_value.update.call_args.kwargs["body"]
        self.assertNotIn("releaseNotes", body["releases"][0])

    def test_abandons_the_edit_when_a_step_fails(self):
        service = fake_service()
        service.edits.return_value.bundles.return_value.upload.return_value.execute.side_effect = (
            RuntimeError("boom")
        )

        with self.assertRaises(RuntimeError):
            play_upload.upload(service, "dev.spwnd.aulora", "alpha", "a.aab", "", mock.MagicMock())

        edits = service.edits.return_value
        edits.delete.assert_called_once_with(packageName="dev.spwnd.aulora", editId="edit-1")
        edits.commit.assert_not_called()


class NotesTests(unittest.TestCase):
    def test_truncates_to_the_play_limit(self):
        with mock.patch.dict(os.environ, {"PLAY_RELEASE_NOTES": "x" * 600}, clear=True):
            self.assertEqual(len(play_upload.release_notes()), play_upload.MAX_NOTES)

    def test_empty_when_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(play_upload.release_notes(), "")


class ConfigTests(unittest.TestCase):
    def test_required_rejects_a_missing_value(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit):
                play_upload.required("PLAY_TRACK")

    def test_media_upload_is_resumable(self):
        calls = {}

        class FakeMediaFileUpload:
            def __init__(self, path, mimetype=None, resumable=False, chunksize=None):
                calls.update(
                    path=path, mimetype=mimetype, resumable=resumable, chunksize=chunksize
                )

        http = types.ModuleType("googleapiclient.http")
        http.MediaFileUpload = FakeMediaFileUpload
        stubbed = {
            "googleapiclient": types.ModuleType("googleapiclient"),
            "googleapiclient.http": http,
        }
        with mock.patch.dict(sys.modules, stubbed):
            play_upload.media_upload("bundle.aab")

        self.assertEqual(calls["path"], "bundle.aab")
        self.assertTrue(calls["resumable"])
        self.assertEqual(calls["chunksize"], play_upload.CHUNK_SIZE)


if __name__ == "__main__":
    unittest.main()
