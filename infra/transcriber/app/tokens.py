"""Audio-token verification shared with Convex.

Wire format: ``<base64url(json payload)>.<base64url(HMAC-SHA256)>``.

The HMAC key is ``SHA-256(TRANSCRIBER_TOKEN || 0x00 || "aulora-audio-token-v1")``,
matching ``packages/convex/convex/lib/transcriptionToken.ts``. The token binds
the transcription session, the call, the exact speaker key and an expiry, so a
client cannot claim another participant's identity.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

KEY_CONTEXT = "aulora-audio-token-v1"


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8") + b"\x00" + KEY_CONTEXT.encode("ascii")).digest()


def sign_claims(
    secret: str,
    *,
    sid: str,
    cid: str,
    sub: str,
    exp: int,
    start: int,
    iat: int | None = None,
) -> str:
    """Mints a token. Used by tests and local simulators, never by a client."""
    payload = {
        "sid": sid,
        "cid": cid,
        "sub": sub,
        "start": int(start),
        "iat": int(time.time()) if iat is None else int(iat),
        "exp": int(exp),
    }
    encoded = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(derive_key(secret), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64encode(signature)}"


def verify_token(secret: str, token: str, now: float | None = None) -> dict[str, Any] | None:
    """Returns verified claims, or ``None`` for any malformed/forged/expired token."""
    if not secret or not isinstance(token, str):
        return None
    separator = token.find(".")
    if separator <= 0 or separator == len(token) - 1:
        return None
    encoded = token[:separator]
    try:
        signature = _b64decode(token[separator + 1 :])
        payload_bytes = _b64decode(encoded)
    except (ValueError, UnicodeError):
        return None
    expected = hmac.new(derive_key(secret), encoded.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        claims = json.loads(payload_bytes)
    except (ValueError, UnicodeError):
        return None
    if not isinstance(claims, dict):
        return None
    if not all(isinstance(claims.get(key), str) for key in ("sid", "cid", "sub")):
        return None
    if not all(isinstance(claims.get(key), int) for key in ("start", "iat", "exp")):
        return None
    current = time.time() if now is None else now
    if claims["exp"] <= current:
        return None
    return claims
