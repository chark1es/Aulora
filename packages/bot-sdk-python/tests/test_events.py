"""Polling, dispatch, self-filtering, cursor and error-loop tests."""

from __future__ import annotations

import asyncio
import logging
import unittest
from typing import Any

from aulora_bot import Bot, Me

from .fake_server import FakeAuloraServer, PollFailure


def message_payload(
    message_id: str = "m1",
    body: str = "hello",
    mentions: tuple[str, ...] = (),
) -> dict[str, Any]:
    return {
        "id": message_id,
        "channelId": "c1",
        "authorId": "u2",
        "body": body,
        "threadRootId": None,
        "replyToId": None,
        "attachmentIds": [],
        "mentionUserIds": list(mentions),
        "editedAt": None,
        "deletedAt": None,
        "createdAt": 1000,
    }


def event(
    event_type: str,
    seq: int,
    *,
    message: bool = True,
    reaction: bool = False,
    self_: bool = False,
    body: str = "hello",
    message_id: str = "m1",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "seq": seq,
        "type": event_type,
        "channelId": "c1",
        "self": self_,
        "message": message_payload(message_id, body) if message else None,
        "reaction": None,
    }
    if reaction:
        payload["reaction"] = {"messageId": message_id, "userId": "u2", "emoji": "👍"}
    return payload


class EventLoopTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.server = FakeAuloraServer().start()
        self.bots: list[Bot] = []
        self.tasks: list[asyncio.Task[Any]] = []
        self.logger = logging.getLogger("aulora_bot")
        self._old_level = self.logger.level
        self.logger.setLevel(logging.CRITICAL)

    async def asyncTearDown(self) -> None:
        for bot in self.bots:
            if bot._running:
                await bot.stop()
        for task in self.tasks:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.logger.setLevel(self._old_level)
        self.server.close()

    def make_bot(self, **kwargs: object) -> Bot:
        bot = Bot(
            token="abt_test",
            site_url=self.server.site_url,
            convex_url=self.server.convex_url,
            poll_interval=0.01,
            **kwargs,
        )
        self.bots.append(bot)
        return bot

    def start(self, bot: Bot) -> asyncio.Task[Any]:
        task = asyncio.create_task(bot.start())
        self.tasks.append(task)
        return task

    async def stop(self, bot: Bot) -> None:
        await bot.stop()


class DispatchTests(EventLoopTestCase):
    async def test_dispatches_every_event_type_sync_and_async(self) -> None:
        bot = self.make_bot()
        seen: set[str] = set()
        calls: dict[str, Any] = {}
        all_seen = asyncio.Event()
        ready_calls: list[Me | None] = []

        def record(name: str) -> Any:
            def handler(value: Any) -> None:
                calls[name] = value
                seen.add(name)
                if len(seen) >= 5:
                    all_seen.set()

            return handler

        @bot.on("ready")
        async def on_ready(me: Me) -> None:
            ready_calls.append(me)

        bot.on("message", record("message"))
        bot.on("messageUpdate", record("message_update"))
        bot.on("messageDelete", record("message_delete"))
        bot.on("reactionAdd", record("reaction_add"))

        @bot.on("reactionRemove")
        async def on_reaction_remove(value: Any) -> None:
            calls["reaction_remove"] = value
            seen.add("reaction_remove")
            if len(seen) >= 5:
                all_seen.set()

        self.server.queue_events(
            [
                event("message.created", 1, body="one"),
                event("message.updated", 2, body="two"),
                event("message.deleted", 3, body=""),
                event("reaction.added", 4, message=False, reaction=True),
                event("reaction.removed", 5, message=False, reaction=True),
            ],
            cursor=20,
        )

        task = self.start(bot)
        await asyncio.wait_for(all_seen.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        self.assertEqual(ready_calls, [Me(user_id="bot_1", name="Test Bot")])
        self.assertEqual(calls["message"].body, "one")
        self.assertEqual(calls["message_update"].body, "two")
        self.assertEqual(calls["message_delete"].body, "")
        self.assertEqual(calls["reaction_add"].emoji, "👍")
        self.assertEqual(calls["reaction_add"].message_id, "m1")
        self.assertEqual(calls["reaction_add"].channel_id, "c1")
        self.assertEqual(calls["reaction_remove"].emoji, "👍")

    async def test_self_events_are_skipped_by_default(self) -> None:
        bot = self.make_bot()
        bodies: list[str] = []
        visible = asyncio.Event()

        @bot.on("message")
        def on_message(message: Any) -> None:
            bodies.append(message.body)
            visible.set()

        self.server.queue_events(
            [
                event("message.created", 1, body="from me", self_=True),
                event("message.created", 2, body="from someone else"),
            ]
        )

        task = self.start(bot)
        await asyncio.wait_for(visible.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        self.assertEqual(bodies, ["from someone else"])

    async def test_include_self_delivers_own_events(self) -> None:
        bot = self.make_bot(include_self=True)
        bodies: list[str] = []
        visible = asyncio.Event()

        @bot.on("message")
        def on_message(message: Any) -> None:
            bodies.append(message.body)
            visible.set()

        self.server.queue_events([event("message.created", 1, body="from me", self_=True)])

        task = self.start(bot)
        await asyncio.wait_for(visible.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        self.assertEqual(bodies, ["from me"])

    async def test_handler_exception_goes_to_error_and_loop_continues(self) -> None:
        bot = self.make_bot()
        errors: list[Exception] = []
        bodies: list[str] = []
        saw_ok = asyncio.Event()

        @bot.on("message")
        def on_message(message: Any) -> None:
            if message.body == "boom":
                raise ValueError("handler failed")
            bodies.append(message.body)
            saw_ok.set()

        @bot.on("error")
        async def on_error(error: Exception) -> None:
            errors.append(error)

        self.server.queue_events(
            [
                event("message.created", 1, body="boom"),
                event("message.created", 2, body="ok"),
            ]
        )

        task = self.start(bot)
        await asyncio.wait_for(saw_ok.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], ValueError)
        self.assertEqual(str(errors[0]), "handler failed")
        self.assertEqual(bodies, ["ok"])

    async def test_zero_argument_handlers_are_supported(self) -> None:
        bot = self.make_bot()
        ready = asyncio.Event()

        @bot.on("ready")
        def on_ready() -> None:
            ready.set()

        task = self.start(bot)
        await asyncio.wait_for(ready.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)


class PollingTests(EventLoopTestCase):
    async def test_poll_errors_back_off_and_keep_the_cursor(self) -> None:
        bot = self.make_bot()
        bot._error_backoff = 0.02
        errors: list[Exception] = []
        bodies: list[str] = []
        saw_event = asyncio.Event()

        @bot.on("error")
        def on_error(error: Exception) -> None:
            errors.append(error)

        @bot.on("message")
        def on_message(message: Any) -> None:
            bodies.append(message.body)
            saw_event.set()

        self.server.queue_poll(PollFailure())
        self.server.queue_events([event("message.created", 2, body="after error")], cursor=11)

        task = self.start(bot)
        await asyncio.wait_for(saw_event.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        self.assertEqual(bodies, ["after error"])
        self.assertEqual(len(errors), 1)
        self.assertEqual(getattr(errors[0], "status", None), 500)
        # First call starts at "now" (10). The failed call and its retry both
        # use the same cursor, so no event can be skipped by the backoff.
        self.assertEqual(self.server.poll_cursors[:3], [None, 10, 10])
        self.assertTrue(all(cursor == 11 for cursor in self.server.poll_cursors[3:]))

    async def test_stop_is_clean_and_stops_polling(self) -> None:
        bot = self.make_bot()
        ready = asyncio.Event()

        @bot.on("ready")
        def on_ready(me: Me) -> None:
            ready.set()

        task = self.start(bot)
        await asyncio.wait_for(ready.wait(), timeout=2)
        await self.stop(bot)
        await asyncio.wait_for(task, timeout=2)

        polled = len(self.server.poll_cursors)
        await asyncio.sleep(0.05)
        self.assertEqual(len(self.server.poll_cursors), polled)
        self.assertFalse(bot._running)
        self.assertTrue(task.done())

    async def test_stop_before_start_is_a_noop(self) -> None:
        bot = self.make_bot()
        await bot.stop()
        self.assertFalse(bot._running)
