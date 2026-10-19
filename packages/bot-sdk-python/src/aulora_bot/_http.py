"""Blocking HTTP plumbing used from an asyncio worker thread."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import socket
import struct
import urllib.error
import urllib.request
from typing import Any, Mapping
from urllib.parse import urlsplit

from ._config import Config
from ._errors import AuloraError, error_from_payload

USER_AGENT = "aulora-bot-python/1.1.0"
DEFAULT_TIMEOUT = 30.0


class HttpTransport:
    """JSON POST client with a fixed timeout and a descriptive user agent.

    `urllib` is blocking, so `post` always runs the request in a worker thread
    and callers await the returned coroutine. That keeps the bot's event loop
    free to dispatch handlers and stop promptly.
    """

    def __init__(self, config: Config, timeout: float = DEFAULT_TIMEOUT) -> None:
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self._config = config
        self._timeout = float(timeout)

    @property
    def timeout(self) -> float:
        return self._timeout

    async def post(
        self,
        url: str,
        headers: Mapping[str, str] | None = None,
        payload: Any = None,
    ) -> Any:
        """POST JSON and return the decoded response body."""
        return await asyncio.to_thread(self._post_sync, url, dict(headers or {}), payload)

    def _post_sync(self, url: str, headers: dict[str, str], payload: Any) -> Any:
        # Config only ever builds http/https URLs; this re-check keeps that
        # guarantee local to the code that actually opens the connection.
        scheme = urlsplit(url).scheme
        if scheme not in ("http", "https"):
            raise ValueError(f"Unsupported URL scheme: {scheme!r}")

        body = json.dumps({} if payload is None else payload).encode("utf-8")
        merged = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
        merged.update(headers)
        request = urllib.request.Request(url, data=body, headers=merged, method="POST")

        try:
            # The scheme is restricted to http/https by Config and re-checked above.
            with urllib.request.urlopen(  # nosec B310
                request, timeout=self._timeout
            ) as response:
                return _decode_json(_read_json(response.read()))
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            raise error_from_payload(
                exc.code,
                _read_json(raw),
                f"HTTP {exc.code} from {urlsplit(url).netloc}",
            ) from None
        except (socket.timeout, TimeoutError):
            raise AuloraError(
                f"Request timed out after {self._timeout:g}s",
                code="timeout",
            ) from None
        except urllib.error.URLError as exc:
            reason = exc.reason if exc.reason is not None else "connection failed"
            raise AuloraError(
                f"Could not reach {urlsplit(url).netloc}: {reason}",
                code="network_error",
            ) from None


def _read_json(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _decode_json(value: Any) -> Any:
    """Decode Convex's JSON encoding, including `{"$integer": "<base64>"}`.

    Convex serializes Int64 values as little-endian two's-complement bytes in
    base64. JSON numbers already arrive as plain Python ints/floats.
    """
    if isinstance(value, dict):
        if len(value) == 1 and "$integer" in value:
            return _decode_integer(value["$integer"])
        return {key: _decode_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode_json(item) for item in value]
    return value


def _decode_integer(encoded: Any) -> int:
    if not isinstance(encoded, str):
        raise AuloraError("Convex returned a malformed $integer value", code="invalid_response")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise AuloraError(
            "Convex returned a malformed $integer value",
            code="invalid_response",
        ) from None
    if len(raw) != 8:
        raise AuloraError(
            "Convex returned a malformed $integer value",
            code="invalid_response",
        )
    return struct.unpack("<q", raw)[0]
