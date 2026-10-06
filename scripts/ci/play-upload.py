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
  PLAY_RELEASE_NOTES                Optional release notes, capped at 500 chars

Google libraries are imported inside the functions so the module can be tested
without the client installed; see play-upload.test.py.
"""

import contextlib
import json
import os
import sys

SCOPE = "https://www.googleapis.com/auth/androidpublisher"
MAX_NOTES = 500
BUNDLE_MIME = "application/octet-stream"


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def release_notes():
    """Return the tester-facing notes, truncated because Play caps them at 500."""
    notes = os.environ.get("PLAY_RELEASE_NOTES", "").strip()
    if len(notes) > MAX_NOTES:
        print(
            f"Warning: PLAY_RELEASE_NOTES was truncated to {MAX_NOTES} characters.",
            file=sys.stderr,
        )
        notes = notes[:MAX_NOTES]
    return notes


def media_upload(path):
    from googleapiclient.http import MediaFileUpload

    # Resumable uploads tolerate a dropped connection on a large bundle.
    return MediaFileUpload(path, mimetype=BUNDLE_MIME, resumable=True)


def create_service(raw_key):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    credentials = service_account.Credentials.from_service_account_info(
        json.loads(raw_key), scopes=[SCOPE]
    )
    return build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)


def upload(service, package, track, aab, notes, media=media_upload):
    """Run one Play edit: insert, upload the bundle, assign the track, commit."""
    edit_id = service.edits().insert(body={}, packageName=package).execute()["id"]
    try:
        bundle = (
            service.edits()
            .bundles()
            .upload(packageName=package, editId=edit_id, media_body=media(aab))
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

    version_code = upload(
        create_service(raw_key), package, track, aab, release_notes()
    )
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
