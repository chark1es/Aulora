"""Aulora transcriber: PCM16 WebSocket in, speaker-labelled segments out.

Protocol (see docs/call-addons-api.md):

1. Connect to ``wss://<site>/transcribe/ws``.
2. First text frame: ``{"type":"auth","token":"<minted audio token>"}`` within
   three seconds. The server replies ``{"type":"ready","sessionId":...,
   "speakerKey":...}`` or closes.
3. Binary frames: 16 kHz mono signed 16-bit little-endian PCM, at most 16 KiB.
4. Optional text frame ``{"type":"end"}`` flushes the last window and closes
   with 1000.

Close codes: 1000 normal, 4400 bad frame, 4401 invalid token, 4408 auth timeout,
4429 too many streams, 4503 model not ready, 1011 internal error.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import time

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from .engine import load_engine
from .frames import AUTH_TIMEOUT_SECONDS
from .hello import build_hello_payload
from .models import ALLOWED_MODELS, LoadedModel, is_allowed_model
from .protocol import (
    CLOSE_AUTH_TIMEOUT,
    CLOSE_INVALID_TOKEN,
    CLOSE_MODEL_NOT_READY,
    CLOSE_REPLACED,
    CLOSE_TOO_MANY_STREAMS,
)
from .restore import record_download_failure, restore_loaded_model, write_selected_model
from .segments import SegmentStream
from .session import serve_stream
from .streams import (
    PreAuthGate,
    StreamRegistry,
    WindowTimeline,
    base_ms_for_session,
    post_json,
)
from .tokens import verify_token

MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
SECRET = os.environ.get("TRANSCRIBER_TOKEN", "")
INGEST_URL = os.environ.get(
    "CONVEX_INGEST_URL", "http://convex-backend:3211/transcription/ingest"
)
STATUS_URL = os.environ.get(
    "CONVEX_MODEL_STATUS_URL", "http://convex-backend:3211/transcription/model"
)
HELLO_URL = os.environ.get(
    "CONVEX_HELLO_URL", "http://convex-backend:3211/transcription/hello"
)
MAX_STREAMS = int(os.environ.get("TRANSCRIBER_MAX_STREAMS", "32"))
# One identity may have one live stream; a new valid token always evicts the
# previous socket instead of rejecting a quick reconnect with 4429.
# Connections that have not authenticated yet are the cheapest abuse target.
PREAUTH_MAX_CONNECTIONS = int(os.environ.get("TRANSCRIBER_PREAUTH_MAX_CONNECTIONS", "128"))
HELLO_INTERVAL_SECONDS = 60.0
INGEST_ATTEMPTS = 3
INGEST_BACKOFF_SECONDS = 0.5

# No interactive docs or schema: the service is internal and has a fixed surface.
app = FastAPI(title="Aulora transcriber", docs_url=None, redoc_url=None, openapi_url=None)
loaded = LoadedModel()


registry = StreamRegistry(MAX_STREAMS)
preauth = PreAuthGate(PREAUTH_MAX_CONNECTIONS)


def _post_json(
    url: str,
    payload: dict[str, object],
    timeout: float = 15.0,
    *,
    attempts: int = 1,
    backoff: float = 0.0,
    opener=None,
    stop_on_rejection: bool = False,
) -> bool:
    kwargs = {
        "attempts": attempts,
        "backoff": backoff,
        "stop_on_rejection": stop_on_rejection,
    }
    if opener is not None:
        return post_json(url, payload, SECRET, timeout, opener=opener, **kwargs)
    return post_json(url, payload, SECRET, timeout, **kwargs)


def report_model_status(
    model_id: str, status: str, *, progress: int | None = None, error: str | None = None
) -> None:
    payload: dict[str, object] = {
        "modelId": model_id,
        "status": status,
    }
    # `null`/omitted means indeterminate, never a fake 0%.
    if progress is not None:
        payload["progress"] = progress
    if error is not None:
        payload["error"] = error
    _post_json(STATUS_URL, payload)


def post_segments(session_id: str, speaker_key: str, segments: list[dict[str, object]]) -> bool:
    if not segments:
        return True
    # A short backoff handles a Convex deploy/restart or a transient 5xx. A
    # dropped batch used to be lost silently; now it is retried and logged.
    return _post_json(
        INGEST_URL,
        {"sessionId": session_id, "speakerKey": speaker_key, "segments": segments},
        attempts=INGEST_ATTEMPTS,
        backoff=INGEST_BACKOFF_SECONDS,
        stop_on_rejection=True,
    )


def download_model(model_id: str) -> None:
    previously_loaded = loaded.engine is not None and loaded.model_id is not None
    loaded.state.start(model_id)
    report_model_status(model_id, "downloading")
    try:
        engine = load_engine(model_id, MODELS_DIR, allow_download=True)
    except Exception:  # noqa: BLE001 - never surface an upstream body
        record_download_failure(loaded, model_id, "Could not download or load the model")
        if previously_loaded and loaded.model_id is not None:
            # Keep serving A; report B's failure as a UI-visible last error.
            report_model_status(
                loaded.model_id, "ready", progress=100, error=loaded.state.error
            )
        else:
            report_model_status(model_id, "error", error=loaded.state.error or "load failed")
        return
    loaded.engine = engine
    loaded.model_id = model_id
    loaded.state.ready(model_id)
    write_selected_model(MODELS_DIR, model_id)
    report_model_status(model_id, "ready", progress=100)


async def heartbeat_loop() -> None:
    """Tells Convex which model is actually loaded, not the last download state."""
    while True:
        # The builder omits absent fields; never post `null` for them.
        payload = build_hello_payload(loaded)
        await asyncio.to_thread(_post_json, HELLO_URL, payload, 10.0)
        await asyncio.sleep(HELLO_INTERVAL_SECONDS)


async def _receive_auth(websocket: WebSocket) -> dict[str, object] | None:
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
        message = json.loads(raw)
    except (TimeoutError, WebSocketDisconnect, ValueError):
        return None
    if not isinstance(message, dict) or message.get("type") != "auth":
        return None
    token = message.get("token")
    return message if isinstance(token, str) else None


def _authorized(header: str) -> bool:
    if not SECRET:
        return False
    provided = header[len("Bearer ") :] if header.startswith("Bearer ") else ""
    return hmac.compare_digest(SECRET.encode(), provided.encode())


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "models": list(ALLOWED_MODELS),
        **loaded.state.snapshot(),
    }


@app.post("/admin/model")
async def admin_model(request: Request) -> JSONResponse:
    if not _authorized(request.headers.get("authorization", "")):
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"ok": False, "error": "invalid_body"}, status_code=400)
    model_id = body.get("modelId") if isinstance(body, dict) else None
    if not isinstance(model_id, str) or not is_allowed_model(model_id):
        return JSONResponse({"ok": False, "error": "unknown_model"}, status_code=400)
    if loaded.state.status == "downloading" and loaded.state.model_id == model_id:
        return JSONResponse({"ok": True, "status": "downloading"}, status_code=202)
    asyncio.create_task(asyncio.to_thread(download_model, model_id))
    return JSONResponse({"ok": True, "status": "downloading"}, status_code=202)


@app.websocket("/ws")
@app.websocket("/")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()
    if not await preauth.begin():
        await websocket.close(code=CLOSE_TOO_MANY_STREAMS, reason="pre-auth limit")
        return
    try:
        auth = await _receive_auth(websocket)
    finally:
        await preauth.end()
    if auth is None:
        await websocket.close(code=CLOSE_AUTH_TIMEOUT, reason="auth timeout")
        return
    claims = verify_token(SECRET, str(auth.get("token", "")))
    if claims is None:
        await websocket.close(code=CLOSE_INVALID_TOKEN, reason="invalid token")
        return
    if not loaded.is_ready():
        await websocket.close(code=CLOSE_MODEL_NOT_READY, reason="model not ready")
        return
    sid = str(claims["sid"])
    sub = str(claims["sub"])
    acquired, previous = await registry.acquire(sid, sub, websocket)
    if not acquired:
        await websocket.close(code=CLOSE_TOO_MANY_STREAMS, reason="too many streams")
        return
    if previous is not None and previous is not websocket:
        # A dedicated code tells the browser this was a replacement, not an
        # idle close: it must not reconnect or two clients live-lock forever.
        try:
            await previous.close(code=CLOSE_REPLACED, reason="replaced by a newer connection")
        except Exception:  # noqa: BLE001 - the old peer may already be gone
            pass
    delivery = await registry.delivery_for(sid, sub)
    stream = SegmentStream(
        session_id=sid,
        speaker_key=sub,
        engine_getter=lambda: loaded.engine,
        timeline=WindowTimeline(
            base_offset_ms=base_ms_for_session(int(claims["start"])),
            opened_at_ms=time.monotonic() * 1000,
        ),
    )
    await websocket.send_json({"type": "ready", "sessionId": sid, "speakerKey": sub})
    # Every teardown path drains the buffered partial window once. Server
    # shutdown closes the socket, so it reaches the same `finally`.
    await serve_stream(
        websocket,
        stream,
        session_id=sid,
        speaker_key=sub,
        # The gate owns sequence assignment and posting across the evicted
        # socket's drain and this replacement's first batches.
        post=lambda session_id, speaker_key, batch: delivery.deliver(
            post_segments, session_id, speaker_key, batch
        ),
        release=lambda: registry.release(sid, sub, websocket),
        disconnect_errors=(WebSocketDisconnect,),
    )


@app.on_event("startup")
async def load_existing_model() -> None:
    """Pick up a model already in the Hugging Face cache after a restart."""
    asyncio.create_task(heartbeat_loop())
    model_id = await asyncio.to_thread(
        restore_loaded_model,
        loaded,
        MODELS_DIR,
        lambda candidate, directory: load_engine(candidate, directory),
    )
    if model_id is not None:
        report_model_status(model_id, "ready", progress=100)
