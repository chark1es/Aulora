"""Small API clients exposed as attributes on `Bot`.

Every method is a thin, typed wrapper over `Bot.call`, so method-to-function
mapping lives in one obvious place.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Mapping

from ._errors import AuloraError
from ._models import Channel, Member, Message

if TYPE_CHECKING:
    from .bot import Bot


class ChannelsClient:
    """`channels:*` queries."""

    def __init__(self, bot: "Bot") -> None:
        self._bot = bot

    async def list(self, *, page_size: int = 100) -> list[Channel]:
        """Return every channel the bot can view, following pagination."""
        if page_size < 1:
            raise ValueError("page_size must be positive")
        channels: list[Channel] = []
        cursor: str | None = None
        for _ in range(1000):
            value = await self._bot.call(
                "channels:list",
                {"paginationOpts": {"numItems": page_size, "cursor": cursor}},
            )
            if not isinstance(value, Mapping):
                break
            page = value.get("page")
            if isinstance(page, list):
                channels.extend(
                    Channel.from_payload(item) for item in page if isinstance(item, Mapping)
                )
            if value.get("isDone", True):
                break
            next_cursor = value.get("continueCursor")
            if not isinstance(next_cursor, str) or not next_cursor:
                break
            cursor = next_cursor
        return channels


class MessagesClient:
    """`messages:*` queries and mutations."""

    def __init__(self, bot: "Bot") -> None:
        self._bot = bot

    async def list(self, channel_id: str, *, limit: int = 50) -> list[Message]:
        """Return the newest page of a channel timeline, oldest first."""
        if limit < 1:
            raise ValueError("limit must be positive")
        value = await self._bot.call(
            "messages:list",
            {
                "channelId": channel_id,
                "paginationOpts": {"numItems": limit, "cursor": None},
            },
        )
        page = value.get("page") if isinstance(value, Mapping) else None
        if not isinstance(page, list):
            return []
        me = self._bot.me
        return [
            Message.from_payload(item, client=self._bot, me_user_id=me.user_id if me else None)
            for item in page
            if isinstance(item, Mapping)
        ]

    async def send(
        self,
        channel_id: str,
        body: str,
        *,
        reply_to_id: str | None = None,
        thread_root_id: str | None = None,
    ) -> Message:
        """Send a message and return the local snapshot of it."""
        args: dict[str, Any] = {"channelId": channel_id, "body": body}
        if reply_to_id is not None:
            args["replyToId"] = reply_to_id
        if thread_root_id is not None:
            args["threadRootId"] = thread_root_id
        message_id = await self._bot.call("messages:send", args, kind="mutation")
        if not isinstance(message_id, str) or not message_id:
            raise AuloraError(
                "messages:send returned no message id",
                code="invalid_response",
            )
        me = self._bot.me
        return Message(
            id=message_id,
            channel_id=channel_id,
            author_id=me.user_id if me is not None else "",
            body=body,
            thread_root_id=thread_root_id,
            reply_to_id=reply_to_id,
            created_at=int(time.time() * 1000),
            _client=self._bot,
            _me_user_id=me.user_id if me is not None else None,
        )

    async def edit(self, message_id: str, body: str) -> Any:
        """Replace a message body."""
        return await self._bot.call(
            "messages:edit",
            {"messageId": message_id, "body": body},
            kind="mutation",
        )

    async def delete(self, message_id: str) -> Any:
        """Delete a message (the server soft-deletes it)."""
        return await self._bot.call(
            "messages:remove",
            {"messageId": message_id},
            kind="mutation",
        )


class ReactionsClient:
    """`reactions:*` mutations.

    The server exposes a single idempotent toggle, so `add`/`remove` call it and
    correct a toggle that flipped the wrong way. This mirrors the TypeScript SDK.
    """

    def __init__(self, bot: "Bot") -> None:
        self._bot = bot

    async def add(self, message_id: str, emoji: str) -> None:
        """Add the bot's reaction to a message."""
        args = {"messageId": message_id, "emoji": emoji}
        result = await self._bot.call("reactions:toggle", args, kind="mutation")
        if isinstance(result, Mapping) and result.get("added") is False:
            await self._bot.call("reactions:toggle", args, kind="mutation")

    async def remove(self, message_id: str, emoji: str) -> None:
        """Remove the bot's reaction from a message."""
        args = {"messageId": message_id, "emoji": emoji}
        result = await self._bot.call("reactions:toggle", args, kind="mutation")
        if isinstance(result, Mapping) and result.get("added") is True:
            await self._bot.call("reactions:toggle", args, kind="mutation")


class MembersClient:
    """`members:*` queries."""

    def __init__(self, bot: "Bot") -> None:
        self._bot = bot

    async def list(self) -> list[Member]:
        """Return every workspace member."""
        value = await self._bot.call("members:list", {})
        if not isinstance(value, list):
            return []
        return [Member.from_payload(item) for item in value if isinstance(item, Mapping)]
