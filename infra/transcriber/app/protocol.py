"""WebSocket close codes shared by the handler and its tests."""

from __future__ import annotations

CLOSE_NORMAL = 1000
CLOSE_BAD_FRAME = 4400
CLOSE_INVALID_TOKEN = 4401
CLOSE_AUTH_TIMEOUT = 4408
CLOSE_TOO_MANY_STREAMS = 4429
CLOSE_MODEL_NOT_READY = 4503
# This socket was replaced by a newer connection for the same participant.
# Clients must NOT auto-reconnect; 4429 remains the capacity/conflict path.
CLOSE_REPLACED = 4410
# Convex rejected a batch permanently (session ended, speaker removed, invalid
# body). Retrying cannot succeed, so the socket closes and must not reconnect.
CLOSE_SESSION_ENDED = 4411
CLOSE_INTERNAL = 1011
