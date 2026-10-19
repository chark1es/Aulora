"""The asyncio `Bot` client: token handling, polling and dispatch."""

from __future__ import annotations

import asyncio
import inspect
import logging
import signal
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping, TypeVar

from ._clients import ChannelsClient, MembersClient, MessagesClient, ReactionsClient
from ._config import API_KINDS, Config
from ._errors import AuloraError, error_from_convex
from ._events import (
    ERROR,
    EVENT_NAMES,
    MESSAGE_EVENTS,
    REACTION_EVENTS,
    READY,
    normalize_event_name,
)
from ._http import DEFAULT_TIMEOUT, HttpTransport
from ._models import Event, Me

logger = logging.getLogger("aulora_bot")

REFRESH_MARGIN_MS = 5 * 60 * 1000
DEFAULT_POLL_INTERVAL = 1.0
ERROR_BACKOFF = 5.0

Handler = Callable[..., Any]
F = TypeVar("F", bound=Handler)


@dataclass(frozen=True)
class _PollResult:
    cursor: int
    events: list[Event]
    raw: Mapping[str, Any]


class Bot:
    """An Aulora bot.

    Options override `AULORA_TOKEN`, `AULORA_SITE_URL` and `AULORA_CONVEX_URL`.
    All network methods are coroutines; handlers may be plain functions or
    coroutine functions.
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        site_url: str | None = None,
        convex_url: str | None = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        include_self: bool = False,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if poll_interval <= 0:
            raise ValueError("poll_interval must be positive")
        self._config = Config.resolve(token, site_url, convex_url)
        self._http = HttpTransport(self._config, timeout)

        self.poll_interval = float(poll_interval)
        self.include_self = include_self
        self.bot_id: str | None = None

        self._handlers: dict[str, list[Handler]] = {name: [] for name in EVENT_NAMES}
        self._jwt: str | None = None
        self._jwt_expires_at_ms = 0.0
        self._me: Me | None = None
        self._auth_lock: asyncio.Lock | None = None
        self._auth_lock_loop: int | None = None

        self._running = False
        self._stop_event: asyncio.Event | None = None
        self._done_event: asyncio.Event | None = None
        self._loop_task: asyncio.Task[Any] | None = None
        self._error_backoff = ERROR_BACKOFF

        self.channels = ChannelsClient(self)
        self.messages = MessagesClient(self)
        self.reactions = ReactionsClient(self)
        self.members = MembersClient(self)

    @property
    def me(self) -> Me | None:
        """The bot identity, populated after the first token exchange."""
        return self._me

    def on(self, name: str, handler: F | None = None) -> Any:
        """Register a handler, directly or as a decorator.

        Accepted names are `ready`, `message`, `message_update`,
        `message_delete`, `reaction_add`, `reaction_remove`, `error`, plus the
        camelCase/dotted aliases from the design contract.
        """
        normalized = normalize_event_name(name)

        def register(function: F) -> F:
            self._handlers[normalized].append(function)
            return function

        if handler is not None:
            return register(handler)
        return register

    async def start(self) -> None:
        """Exchange the token, emit `ready`, then poll until `stop()`."""
        if self._running:
            raise RuntimeError("Bot is already running")
        self._running = True
        self._loop_task = asyncio.current_task()
        self._stop_event = asyncio.Event()
        self._done_event = asyncio.Event()
        try:
            await self._ensure_auth()
            await self._emit(READY, self._me)
            await self._poll_loop()
        finally:
            self._running = False
            self._loop_task = None
            if self._done_event is not None:
                self._done_event.set()

    async def stop(self) -> None:
        """Ask the poll loop to stop and wait for it to finish."""
        stop_event = self._stop_event
        if stop_event is None:
            return
        stop_event.set()
        done = self._done_event
        if done is None or asyncio.current_task() is self._loop_task:
            return
        await done.wait()

    def run(self) -> None:
        """Blocking entry point. Stops on SIGTERM or SIGINT."""
        try:
            asyncio.run(self._run_with_signals())
        except KeyboardInterrupt:
            pass

    async def call(
        self,
        path: str,
        args: Mapping[str, Any] | None = None,
        kind: str = "query",
    ) -> Any:
        """Escape hatch: call any Convex function as the bot."""
        if not isinstance(path, str) or not path:
            raise ValueError("path must be a non-empty function path")
        if kind not in API_KINDS:
            raise ValueError(f"Unknown Convex function kind: {kind!r}")
        payload = dict(args or {})
        await self._ensure_auth()
        try:
            return await self._convex_request(path, payload, kind)
        except AuloraError as exc:
            if not _is_auth_error(exc):
                raise
        # The JWT may have been revoked or expired early. Refresh once and
        # retry the same call; if that fails the error reaches the caller.
        await self._ensure_auth(force=True)
        return await self._convex_request(path, payload, kind)

    async def _convex_request(self, path: str, args: dict[str, Any], kind: str) -> Any:
        result = await self._http.post(
            self._config.api_url(kind),
            headers={"Authorization": f"Bearer {self._jwt}"},
            payload={"path": path, "args": args, "format": "json"},
        )
        if isinstance(result, Mapping):
            status = result.get("status")
            if status == "success":
                return result.get("value")
            if status == "error":
                raise error_from_convex(result)
        return result

    async def _run_with_signals(self) -> None:
        loop = asyncio.get_running_loop()
        installed: list[signal.Signals] = []
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGTERM, signal.SIGINT):
                try:
                    loop.add_signal_handler(signum, self._request_stop)
                    installed.append(signum)
                except (NotImplementedError, RuntimeError, ValueError):
                    pass
        try:
            await self.start()
        finally:
            for signum in installed:
                try:
                    loop.remove_signal_handler(signum)
                except (NotImplementedError, RuntimeError, ValueError):
                    pass

    def _request_stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()

    async def _ensure_auth(self, *, force: bool = False) -> None:
        loop_id = id(asyncio.get_running_loop())
        if self._auth_lock is None or self._auth_lock_loop != loop_id:
            self._auth_lock = asyncio.Lock()
            self._auth_lock_loop = loop_id
        async with self._auth_lock:
            now_ms = time.time() * 1000
            if (
                force
                or self._jwt is None
                or self._jwt_expires_at_ms - now_ms <= REFRESH_MARGIN_MS
            ):
                await self._exchange_token(now_ms)

    async def _exchange_token(self, now_ms: float) -> None:
        result = await self._http.post(
            self._config.token_url(),
            headers={"Authorization": f"Bot {self._config.token}"},
            payload={},
        )
        if not isinstance(result, Mapping):
            raise AuloraError(
                "Token endpoint returned an invalid response",
                code="invalid_response",
            )
        token = result.get("token")
        if not isinstance(token, str) or not token:
            raise AuloraError(
                "Token endpoint returned no token",
                code="invalid_response",
            )
        expires_at = result.get("expiresAt")
        if isinstance(expires_at, (int, float)) and not isinstance(expires_at, bool):
            self._jwt_expires_at_ms = float(expires_at)
        else:
            self._jwt_expires_at_ms = now_ms + 55 * 60 * 1000
        self._jwt = token

        user_id = result.get("userId")
        name = result.get("name")
        self._me = Me(
            user_id=str(user_id) if user_id is not None else "",
            name=str(name) if name is not None else "",
        )
        bot_id = result.get("botId")
        if bot_id is not None:
            self.bot_id = str(bot_id)

    async def _poll_loop(self) -> None:
        cursor: int | None = None
        while self._stop_event is not None and not self._stop_event.is_set():
            try:
                result = await self._poll_once(cursor)
            except AuloraError as exc:
                await self._report_error(exc)
                await self._sleep(self._error_backoff)
                continue
            except Exception as exc:  # noqa: BLE001 - a poll must never kill the loop
                await self._report_error(exc)
                await self._sleep(self._error_backoff)
                continue

            cursor = result.cursor
            self._update_me(result.raw)
            for event in result.events:
                if self._stop_event is not None and self._stop_event.is_set():
                    break
                if event.self_ and not self.include_self:
                    continue
                await self._dispatch(event)
            await self._sleep(self.poll_interval)

    async def _poll_once(self, cursor: int | None) -> _PollResult:
        value = await self.call("botEvents:poll", {"cursor": cursor})
        if not isinstance(value, Mapping):
            raise AuloraError(
                "botEvents:poll returned an invalid response",
                code="invalid_response",
            )
        new_cursor = value.get("cursor")
        if isinstance(new_cursor, bool) or not isinstance(new_cursor, (int, float)):
            raise AuloraError(
                "botEvents:poll returned an invalid cursor",
                code="invalid_response",
            )
        raw_events = value.get("events")
        if raw_events is None:
            raw_events = []
        if not isinstance(raw_events, list):
            raise AuloraError(
                "botEvents:poll returned invalid events",
                code="invalid_response",
            )
        me = self._me
        events = [
            Event.from_payload(
                item,
                client=self,
                me_user_id=me.user_id if me is not None else None,
            )
            for item in raw_events
            if isinstance(item, Mapping)
        ]
        return _PollResult(cursor=int(new_cursor), events=events, raw=value)

    def _update_me(self, payload: Mapping[str, Any]) -> None:
        me = payload.get("me")
        if not isinstance(me, Mapping):
            return
        user_id = me.get("userId")
        name = me.get("name")
        if user_id:
            self._me = Me(user_id=str(user_id), name=str(name or ""))

    async def _dispatch(self, event: Event) -> None:
        if event.type in MESSAGE_EVENTS:
            if event.message is None:
                await self._report_error(
                    AuloraError(
                        f"{event.type} event did not include a message",
                        code="invalid_event",
                    )
                )
                return
            await self._emit(event.type, event.message)
            return
        if event.type in REACTION_EVENTS:
            if event.reaction is None:
                await self._report_error(
                    AuloraError(
                        f"{event.type} event did not include a reaction",
                        code="invalid_event",
                    )
                )
                return
            await self._emit(event.type, event.reaction)
            return
        logger.debug("Ignoring unknown bot event type %r", event.type)

    async def _emit(self, name: str, payload: Any) -> None:
        for handler in tuple(self._handlers[name]):
            try:
                await _invoke(handler, payload)
            except Exception as exc:  # noqa: BLE001 - handlers must not kill the loop
                logger.error(
                    "Handler for %r failed: %s",
                    name,
                    exc,
                    exc_info=(type(exc), exc, exc.__traceback__),
                )
                await self._report_error(exc, log=False)

    async def _report_error(self, exc: Exception, *, log: bool = True) -> None:
        if log:
            logger.error(
                "Bot error: %s",
                exc,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
        for handler in tuple(self._handlers[ERROR]):
            try:
                await _invoke(handler, exc)
            except Exception as handler_exc:  # noqa: BLE001 - never recurse forever
                logger.error(
                    "Error handler failed: %s",
                    handler_exc,
                    exc_info=(type(handler_exc), handler_exc, handler_exc.__traceback__),
                )

    async def _sleep(self, seconds: float) -> None:
        if seconds <= 0:
            return
        stop_event = self._stop_event
        if stop_event is None:
            await asyncio.sleep(seconds)
            return
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass


async def _invoke(handler: Handler, payload: Any) -> None:
    if _handler_takes_argument(handler):
        result = handler(payload)
    else:
        result = handler()
    if inspect.isawaitable(result):
        await result


def _handler_takes_argument(handler: Handler) -> bool:
    try:
        signature = inspect.signature(handler)
    except (TypeError, ValueError):
        return True
    for parameter in signature.parameters.values():
        if parameter.kind in (
            parameter.VAR_POSITIONAL,
            parameter.VAR_KEYWORD,
            parameter.POSITIONAL_ONLY,
            parameter.POSITIONAL_OR_KEYWORD,
        ):
            return True
    return False


def _is_auth_error(exc: AuloraError) -> bool:
    if exc.status == 401:
        return True
    if exc.code in {"unauthenticated", "unauthorized", "invalid_token", "token_expired"}:
        return True
    message = exc.message.lower()
    return any(
        marker in message
        for marker in (
            "unauthenticated",
            "unauthorized",
            "not authenticated",
            "invalid jwt",
            "jwt expired",
            "token expired",
        )
    )


__all__ = ["Bot"]
