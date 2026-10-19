"""Value objects handed to bot handlers and returned by the client."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from ._events import server_event_name


@dataclass(frozen=True)
class Me:
    """The bot's own identity."""

    user_id: str
    name: str


@dataclass(frozen=True)
class Channel:
    """A visible channel summary."""

    id: str
    kind: str = ""
    category_id: str | None = None
    name: str | None = None
    topic: str | None = None
    archived: bool = False
    is_private: bool = False
    position: float = 0
    hidden: bool = False
    muted: bool = False
    pinned: bool = False
    pinned_at: float | None = None
    member_ids: list[str] | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "Channel":
        member_ids = payload.get("memberIds")
        return cls(
            id=str(payload.get("id", "")),
            kind=str(payload.get("kind", "")),
            category_id=_optional_str(payload.get("categoryId")),
            name=_optional_str(payload.get("name")),
            topic=_optional_str(payload.get("topic")),
            archived=bool(payload.get("archived", False)),
            is_private=bool(payload.get("isPrivate", False)),
            position=float(payload.get("position", 0) or 0),
            hidden=bool(payload.get("hidden", False)),
            muted=bool(payload.get("muted", False)),
            pinned=bool(payload.get("pinned", False)),
            pinned_at=_optional_float(payload.get("pinnedAt")),
            member_ids=[str(item) for item in member_ids] if isinstance(member_ids, list) else None,
        )


@dataclass(frozen=True)
class Member:
    """A workspace member. Bots have `is_bot` set."""

    user_id: str
    id: str = ""
    nickname: str | None = None
    account_name: str | None = None
    role_ids: list[str] = field(default_factory=list)
    joined_at: float = 0
    timeout_until: float | None = None
    avatar_url: str | None = None
    is_bot: bool = False

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "Member":
        role_ids = payload.get("roleIds")
        return cls(
            user_id=str(payload.get("userId", "")),
            id=str(payload.get("id", "")),
            nickname=_optional_str(payload.get("nickname")),
            account_name=_optional_str(payload.get("accountName")),
            role_ids=[str(item) for item in role_ids] if isinstance(role_ids, list) else [],
            joined_at=float(payload.get("joinedAt", 0) or 0),
            timeout_until=_optional_float(payload.get("timeoutUntil")),
            avatar_url=_optional_str(payload.get("avatarUrl")),
            is_bot=bool(payload.get("isBot", False)),
        )


@dataclass(frozen=True)
class Reaction:
    """A reaction delivered by a `reactionAdd` / `reactionRemove` event."""

    message_id: str
    user_id: str
    emoji: str
    channel_id: str | None = None

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
        channel_id: str | None = None,
    ) -> "Reaction":
        return cls(
            message_id=str(payload.get("messageId", "")),
            user_id=str(payload.get("userId", "")),
            emoji=str(payload.get("emoji", "")),
            channel_id=channel_id,
        )


@dataclass
class Message:
    """One message, with helpers that call back into the API as the bot."""

    id: str
    channel_id: str
    author_id: str
    body: str
    thread_root_id: str | None = None
    reply_to_id: str | None = None
    mention_user_ids: list[str] = field(default_factory=list)
    created_at: float = 0
    edited_at: float | None = None
    deleted_at: float | None = None
    attachment_ids: list[str] = field(default_factory=list)
    _client: Any = field(default=None, repr=False, compare=False)
    _me_user_id: str | None = field(default=None, repr=False, compare=False)

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
        client: Any = None,
        me_user_id: str | None = None,
    ) -> "Message":
        mentions = payload.get("mentionUserIds")
        attachments = payload.get("attachmentIds")
        return cls(
            id=str(payload.get("id", "")),
            channel_id=str(payload.get("channelId", "")),
            author_id=str(payload.get("authorId", "")),
            body=str(payload.get("body", "")),
            thread_root_id=_optional_str(payload.get("threadRootId")),
            reply_to_id=_optional_str(payload.get("replyToId")),
            mention_user_ids=[str(item) for item in mentions] if isinstance(mentions, list) else [],
            created_at=float(payload.get("createdAt", 0) or 0),
            edited_at=_optional_float(payload.get("editedAt")),
            deleted_at=_optional_float(payload.get("deletedAt")),
            attachment_ids=[str(item) for item in attachments]
            if isinstance(attachments, list)
            else [],
            _client=client,
            _me_user_id=me_user_id,
        )

    @property
    def mentions_me(self) -> bool:
        """Whether this message mentions the bot."""
        client = self._client
        me = client.me if client is not None else None
        user_id = me.user_id if me is not None else self._me_user_id
        return user_id is not None and user_id in self.mention_user_ids

    async def reply(self, body: str) -> "Message":
        """Send a reply, staying inside the same thread for a thread reply."""
        return await self._require_client().messages.send(
            self.channel_id,
            body,
            reply_to_id=self.id,
            thread_root_id=self.thread_root_id,
        )

    async def react(self, emoji: str) -> None:
        """Add a reaction to this message."""
        await self._require_client().reactions.add(self.id, emoji)

    async def delete(self) -> None:
        """Delete this message (soft delete on the server)."""
        await self._require_client().messages.delete(self.id)

    async def edit(self, body: str) -> None:
        """Replace this message's body and update the local snapshot."""
        await self._require_client().messages.edit(self.id, body)
        self.body = body

    def _require_client(self) -> Any:
        if self._client is None:
            raise RuntimeError("This Message is not attached to a Bot")
        return self._client


@dataclass(frozen=True)
class Event:
    """A normalized event from `botEvents:poll`."""

    type: str
    seq: int
    channel_id: str
    self_: bool = False
    message: Message | None = None
    reaction: Reaction | None = None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def is_self(self) -> bool:
        """Alias for `self_`, matching the server's `self` field."""
        return self.self_

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
        client: Any = None,
        me_user_id: str | None = None,
    ) -> "Event":
        channel_id = str(payload.get("channelId", ""))
        raw_message = payload.get("message")
        raw_reaction = payload.get("reaction")
        message = (
            Message.from_payload(raw_message, client=client, me_user_id=me_user_id)
            if isinstance(raw_message, Mapping)
            else None
        )
        reaction = (
            Reaction.from_payload(raw_reaction, channel_id=channel_id)
            if isinstance(raw_reaction, Mapping)
            else None
        )
        return cls(
            type=server_event_name(str(payload.get("type", ""))),
            seq=int(payload.get("seq", 0) or 0),
            channel_id=channel_id,
            self_=bool(payload.get("self", False)),
            message=message,
            reaction=reaction,
            raw=payload,
        )


def _optional_str(value: Any) -> str | None:
    return None if value is None else str(value)


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
