"""Event-name normalization shared by `Bot.on` and the poll loop."""

from __future__ import annotations

READY = "ready"
MESSAGE = "message"
MESSAGE_UPDATE = "message_update"
MESSAGE_DELETE = "message_delete"
REACTION_ADD = "reaction_add"
REACTION_REMOVE = "reaction_remove"
ERROR = "error"

EVENT_NAMES = (
    READY,
    MESSAGE,
    MESSAGE_UPDATE,
    MESSAGE_DELETE,
    REACTION_ADD,
    REACTION_REMOVE,
    ERROR,
)

MESSAGE_EVENTS = frozenset({MESSAGE, MESSAGE_UPDATE, MESSAGE_DELETE})
REACTION_EVENTS = frozenset({REACTION_ADD, REACTION_REMOVE})

# Accept both the Python names and the camelCase / dotted names from the design
# contract. Comparison is case-insensitive after stripping.
_ALIASES = {
    "ready": READY,
    "message": MESSAGE,
    "message.created": MESSAGE,
    "message_created": MESSAGE,
    "messagecreated": MESSAGE,
    "message_update": MESSAGE_UPDATE,
    "message.update": MESSAGE_UPDATE,
    "message.updated": MESSAGE_UPDATE,
    "messageupdate": MESSAGE_UPDATE,
    "message_delete": MESSAGE_DELETE,
    "message.delete": MESSAGE_DELETE,
    "message.deleted": MESSAGE_DELETE,
    "messagedelete": MESSAGE_DELETE,
    "reaction_add": REACTION_ADD,
    "reaction.added": REACTION_ADD,
    "reactionadd": REACTION_ADD,
    "reaction_remove": REACTION_REMOVE,
    "reaction.removed": REACTION_REMOVE,
    "reactionremove": REACTION_REMOVE,
    "error": ERROR,
}


def normalize_event_name(name: str) -> str:
    """Return the canonical event name or raise `ValueError`."""
    if not isinstance(name, str):
        raise TypeError("event name must be a string")
    normalized = _ALIASES.get(name.strip().lower())
    if normalized is None:
        allowed = ", ".join(EVENT_NAMES)
        raise ValueError(f"Unknown event {name!r}; expected one of: {allowed}")
    return normalized


def server_event_name(name: str) -> str:
    """Map a server event type (`message.created`) to its handler name.

    Unknown types are returned unchanged so a newer server can add event types
    without breaking an older SDK; the dispatcher ignores them.
    """
    return _ALIASES.get(name.strip().lower(), name)
