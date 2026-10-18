"""Python SDK for Aulora bots.

The package uses only the Python standard library. Construct a `Bot` from the
environment (or explicit options), register handlers, and call `run()`.
"""

from __future__ import annotations

import logging

from ._config import Config
from ._errors import AuloraError
from ._models import Channel, Event, Me, Member, Message, Reaction
from .bot import Bot

__version__ = "1.1.0"

logging.getLogger("aulora_bot").addHandler(logging.NullHandler())

__all__ = [
    "AuloraError",
    "Bot",
    "Channel",
    "Config",
    "Event",
    "Me",
    "Member",
    "Message",
    "Reaction",
    "__version__",
]
