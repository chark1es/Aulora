"""Upload one signed Android App Bundle to a Google Play track.

The service account JSON, package name, track and bundle path are read from the
environment so no private value reaches the command line or a workflow log. The
service account must have the Google Play Android Developer API enabled and
release access to the target app in Play Console.

Environment:
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  Service account key JSON (text)
  PLAY_PACKAGE_NAME                 Application id, e.g. dev.spwnd.aulora
  PLAY_TRACK                        Track id: internal, alpha, beta, production
  PLAY_AAB                          Path to the signed .aab
  PLAY_RELEASE_NOTES                Optional release notes, up to 500 characters
"""

import contextlib
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPE = "https://www.googleapis.com/auth/androidpublisher"
MAX_NOTES = 500


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def release_notes():
    notes = os.environ.get("PLAY_RELEASE_NOTES", "").strip()
    if len(notes) > MAX_NOTES:
        raise SystemExit(f"PLAY_RELEASE_NOTES exceeds {MAX_NOTES} characters")
    return notes


def upload(service, package, track, aab, notes):
    edit_id = service.edits().insert(body={}, packageName=package).execute()["id"]
    try:
        bundle = (
            service.edits()
            .bundles()
            .upload(
                packageName=package,
                editId=edit_id,
                media_body=MediaFileUpload(aab, mimetype="application/octet-stream"),
            )
            .execute()
        )
        version_code = str(bundle["versionCode"])
        release = {"status": "completed", "versionCodes": [version_code]}
        if notes:
            release["releaseNotes"] = [{"language": "en-US", "text": notes}]
        service.edits().tracks().update(
            packageName=package,
            editId=edit_id,
            track=track,
            body={"releases": [release]},
        ).execute()
        service.edits().commit(packageName=package, editId=edit_id).execute()
        return version_code
    except Exception:
        # Abandon the edit so a failed upload does not leave a stale draft.
        with contextlib.suppress(Exception):
            service.edits().delete(packageName=package, editId=edit_id).execute()
        raise


def main():
    package = required("PLAY_PACKAGE_NAME")
    track = required("PLAY_TRACK")
    aab = required("PLAY_AAB")
    raw_key = required("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")

    if not os.path.isfile(aab):
        raise SystemExit(f"Bundle not found: {aab}")

    credentials = service_account.Credentials.from_service_account_info(
        json.loads(raw_key), scopes=[SCOPE]
    )
    service = build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)

    version_code = upload(service, package, track, aab, release_notes())
    line = f"Uploaded {package} versionCode {version_code} to the '{track}' track."
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write(line + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Google Play upload failed: {error}", file=sys.stderr)
        sys.exit(1)
