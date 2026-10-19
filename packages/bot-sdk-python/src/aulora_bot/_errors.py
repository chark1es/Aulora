"""Errors raised by the Aulora bot SDK."""

from __future__ import annotations

from typing import Any, Mapping


class AuloraError(Exception):
    """A failed Aulora request or event-feed operation.

    `message` carries the server's human-readable message, `code` a stable
    machine-readable identifier when the server supplied one (for example
    `invalid_token`, `bot_disabled`, `unauthenticated`, or `rate_limited`), and
    `data` the structured `errorData` payload when there was one.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        data: Any = None,
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.data = data
        self.status = status

    def __str__(self) -> str:
        return self.message


def error_from_payload(
    status: int,
    payload: Any,
    fallback: str,
) -> AuloraError:
    """Map an HTTP or Convex error payload to an `AuloraError`."""
    message = fallback
    data: Any = payload
    code = _code_from_payload(payload)

    if isinstance(payload, Mapping):
        reported = payload.get("errorMessage")
        if not isinstance(reported, str) or not reported:
            reported = payload.get("error")
        if not isinstance(reported, str) or not reported:
            reported = payload.get("message")
        if isinstance(reported, str) and reported:
            message = reported
        if "errorData" in payload:
            data = payload.get("errorData")

    if code is None and status == 401:
        code = "unauthenticated"
    if code is None and status == 403:
        code = "forbidden"
    if code is None and status == 429:
        code = "rate_limited"

    return AuloraError(message, code=code, data=data, status=status)


def error_from_convex(payload: Mapping[str, Any]) -> AuloraError:
    """Map a `{"status":"error", ...}` Convex response body."""
    message = payload.get("errorMessage")
    if not isinstance(message, str) or not message:
        data = payload.get("errorData")
        if isinstance(data, Mapping) and isinstance(data.get("message"), str):
            message = data["message"]
        else:
            message = "Convex request failed"
    return AuloraError(
        message,
        code=_code_from_payload(payload),
        data=payload.get("errorData"),
    )


def _code_from_payload(payload: Any) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    for key in ("error", "code", "kind"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    data = payload.get("errorData")
    if isinstance(data, Mapping):
        for key in ("code", "kind", "name"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return value
    return None
