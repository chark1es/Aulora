"""Builds the heartbeat payload without FastAPI.

The heartbeat must never send ``null`` for an absent optional field: the Convex
validator historically rejected ``loadedModelId: null`` and, because presence
was recorded after model handling, a cold start never reported the service as
installed. Keep the builder in this tiny module so both the heartbeat loop and
the tests use the exact same payload construction.
"""

from __future__ import annotations

from .models import LoadedModel


def build_hello_payload(loaded: LoadedModel) -> dict[str, object]:
    """The exact body posted to ``/transcription/hello``.

    Absent optional fields are omitted entirely, never encoded as ``null``.
    ``loadedStatus`` is always known, so it is always present.
    """
    ready = loaded.engine is not None and loaded.model_id is not None
    payload: dict[str, object] = {
        "type": "hello",
        "loadedStatus": "ready" if ready else "not_installed",
    }
    # Only a model actually serving audio is "loaded"; a download target is not.
    if ready and loaded.model_id is not None:
        payload["loadedModelId"] = loaded.model_id
    if loaded.state.error is not None:
        payload["loadedError"] = loaded.state.error
    # Only present while a download is actually running. Absence tells Convex a
    # restarted container is not still downloading the old model.
    if loaded.state.status == "downloading":
        payload["downloadActive"] = True
    return payload
