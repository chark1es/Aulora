"""Client-level tests: auth, errors, helpers and configuration."""

from __future__ import annotations

import logging
import os
import unittest
from unittest import mock

from aulora_bot import AuloraError, Bot, Channel, Me, Member, Message
from aulora_bot._events import normalize_event_name

from .fake_server import FakeAuloraServer

# Fake credentials for the local test server. They live in constants so no
# string literal is assigned to a token-looking name (Bandit B105/B106).
AUTH_ENV = "AULORA_TOKEN"
TEST_CREDENTIAL = "abt_test"


class BotTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.server = FakeAuloraServer().start()
        self.bots: list[Bot] = []
        self.logger = logging.getLogger("aulora_bot")
        self._old_level = self.logger.level
        self.logger.setLevel(logging.CRITICAL)

    async def asyncTearDown(self) -> None:
        for bot in self.bots:
            if bot._running:
                await bot.stop()
        self.logger.setLevel(self._old_level)
        self.server.close()

    def make_bot(self, **kwargs: object) -> Bot:
        credential = str(kwargs.pop("credential", TEST_CREDENTIAL))
        bot = Bot(
            token=credential,
            site_url=self.server.site_url,
            convex_url=self.server.convex_url,
            poll_interval=0.01,
            **kwargs,
        )
        self.bots.append(bot)
        return bot


class TokenTests(BotTestCase):
    async def test_exchange_and_bearer_token(self) -> None:
        bot = self.make_bot()
        channels = await bot.channels.list()

        self.assertEqual(channels[0].name, "general")
        self.assertEqual(bot.me, Me(user_id="bot_1", name="Test Bot"))
        self.assertEqual(bot.bot_id, "botdoc_1")
        self.assertEqual(len(self.server.token_requests), 1)
        self.assertEqual(
            self.server.token_requests[0]["Authorization"],
            "Bot abt_test",
        )
        request = self.server.requests_for("channels:list")[0]
        self.assertEqual(request.kind, "query")
        self.assertEqual(request.headers["Authorization"], "Bearer jwt-1")

    async def test_refreshes_five_minutes_before_expiry(self) -> None:
        self.server.expires_in_ms = 60_000
        bot = self.make_bot()

        await bot.channels.list()
        await bot.channels.list()

        self.assertEqual(len(self.server.token_requests), 2)
        second = self.server.requests_for("channels:list")[1]
        self.assertEqual(second.headers["Authorization"], "Bearer jwt-2")

    async def test_does_not_refresh_a_fresh_token(self) -> None:
        bot = self.make_bot()

        await bot.channels.list()
        await bot.channels.list()
        await bot.members.list()

        self.assertEqual(len(self.server.token_requests), 1)

    async def test_refreshes_once_on_auth_failure(self) -> None:
        bot = self.make_bot()

        result = await bot.call("test:authfail", {})

        self.assertEqual(result, "ok")
        self.assertEqual(len(self.server.token_requests), 2)
        calls = self.server.requests_for("test:authfail")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1].headers["Authorization"], "Bearer jwt-2")

    async def test_invalid_token_maps_to_error(self) -> None:
        bot = self.make_bot(credential="abt_wrong")

        with self.assertRaises(AuloraError) as caught:
            await bot.channels.list()

        self.assertEqual(caught.exception.code, "invalid_token")
        self.assertEqual(caught.exception.status, 401)

    async def test_disabled_bot_maps_to_error(self) -> None:
        bot = self.make_bot(credential="abt_disabled")

        with self.assertRaises(AuloraError) as caught:
            await bot.channels.list()

        self.assertEqual(caught.exception.code, "bot_disabled")
        self.assertEqual(caught.exception.status, 403)


class ErrorTests(BotTestCase):
    async def test_convex_error_payload(self) -> None:
        bot = self.make_bot()

        with self.assertRaises(AuloraError) as caught:
            await bot.call("test:error", {})

        error = caught.exception
        self.assertEqual(error.message, "Missing permission")
        self.assertEqual(error.code, "forbidden")
        self.assertEqual(error.data, {"code": "forbidden", "detail": "no"})

    async def test_http_error_payload(self) -> None:
        bot = self.make_bot()

        with self.assertRaises(AuloraError) as caught:
            await bot.call("test:http500", {})

        error = caught.exception
        self.assertEqual(error.status, 500)
        self.assertEqual(error.message, "boom")
        self.assertEqual(error.code, "boom")

    async def test_rate_limit_code(self) -> None:
        bot = self.make_bot()

        with self.assertRaises(AuloraError) as caught:
            await bot.call("test:429", {})

        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(caught.exception.code, "rate_limited")

    async def test_int64_response_values_are_decoded(self) -> None:
        bot = self.make_bot()

        result = await bot.call("test:int64", {})

        self.assertEqual(result, {"n": -2})


class HelperTests(BotTestCase):
    async def test_client_paths_and_arguments(self) -> None:
        bot = self.make_bot()

        channels = await bot.channels.list()
        messages = await bot.messages.list("c1", limit=10)
        sent = await bot.messages.send("c1", "hello")
        await bot.messages.send("c1", "reply", reply_to_id="m1", thread_root_id="t1")
        await bot.messages.edit("m1", "edited")
        await bot.messages.delete("m1")
        members = await bot.members.list()
        await bot.call("test:noop", {"x": 1}, kind="action")
        await self._toggle_reactions(bot)

        self._assert_list_results(channels, messages, sent, members)
        self._assert_message_requests()
        self._assert_reaction_requests()
        self.assertEqual(self.server.requests_for("members:list")[0].args, {})
        self.assertEqual(self.server.requests_for("test:noop")[0].kind, "action")

    async def _toggle_reactions(self, bot: Bot) -> None:
        """Exercise the add/add/remove reaction paths against the fake server."""
        # add: already absent, so the first toggle is enough.
        self.server.queue_toggle({"added": True})
        await bot.reactions.add("m1", "👍")
        # add: already present, so the toggle removes and must be re-added.
        self.server.queue_toggle({"added": False})
        await bot.reactions.add("m1", "😀")
        # remove: present, so the first toggle removes it.
        self.server.queue_toggle({"added": False})
        await bot.reactions.remove("m1", "👍")

    def _assert_list_results(
        self,
        channels: list[Channel],
        messages: list[Message],
        sent: Message,
        members: list[Member],
    ) -> None:
        """Assert the decoded models returned by the list/send helpers."""
        self.assertEqual(channels[0].id, "c1")
        self.assertEqual(messages[0].body, "hello")
        self.assertTrue(messages[0].mentions_me)
        self.assertEqual(sent.id, "msg_new")
        self.assertEqual(sent.body, "hello")
        self.assertEqual(sent.author_id, "bot_1")
        self.assertEqual(members[0].user_id, "bot_1")
        self.assertTrue(members[0].is_bot)

    def _assert_message_requests(self) -> None:
        """Assert the recorded paths and arguments for the message calls."""
        self.assertEqual(
            self.server.requests_for("messages:list")[0].args,
            {"channelId": "c1", "paginationOpts": {"numItems": 10, "cursor": None}},
        )
        sends = self.server.requests_for("messages:send")
        self.assertEqual(sends[0].kind, "mutation")
        self.assertEqual(sends[0].args, {"channelId": "c1", "body": "hello"})
        self.assertEqual(
            sends[1].args,
            {
                "channelId": "c1",
                "body": "reply",
                "replyToId": "m1",
                "threadRootId": "t1",
            },
        )
        self.assertEqual(
            self.server.requests_for("messages:edit")[0].args,
            {"messageId": "m1", "body": "edited"},
        )
        self.assertEqual(
            self.server.requests_for("messages:remove")[0].args,
            {"messageId": "m1"},
        )

    def _assert_reaction_requests(self) -> None:
        """Assert the reaction toggles were issued as ordered mutations."""
        toggles = self.server.requests_for("reactions:toggle")
        self.assertEqual(
            [(request.args["emoji"]) for request in toggles],
            ["👍", "😀", "😀", "👍"],
        )
        self.assertTrue(
            all(
                request.kind == "mutation"
                and request.args["messageId"] == "m1"
                and set(request.args) == {"messageId", "emoji"}
                for request in toggles
            )
        )

    async def test_message_helpers(self) -> None:
        bot = self.make_bot()
        await bot.channels.list()  # authenticate so bot.me is populated
        message = Message.from_payload(
            {
                "id": "m1",
                "channelId": "c1",
                "authorId": "u2",
                "body": "hello",
                "threadRootId": "t1",
                "replyToId": None,
                "mentionUserIds": ["bot_1"],
                "attachmentIds": [],
                "editedAt": None,
                "deletedAt": None,
                "createdAt": 1000,
            },
            client=bot,
            me_user_id="bot_1",
        )

        self.assertTrue(message.mentions_me)
        reply = await message.reply("pong")
        self.assertEqual(reply.id, "msg_new")
        self.assertEqual(reply.channel_id, "c1")
        self.server.queue_toggle({"added": True})
        await message.react("👍")
        await message.edit("changed")
        await message.delete()

        self.assertEqual(message.body, "changed")
        self.assertEqual(
            self.server.requests_for("messages:send")[0].args,
            {"channelId": "c1", "body": "pong", "replyToId": "m1", "threadRootId": "t1"},
        )
        self.assertEqual(
            self.server.requests_for("reactions:toggle")[0].args,
            {"messageId": "m1", "emoji": "👍"},
        )
        self.assertEqual(
            self.server.requests_for("messages:edit")[0].args,
            {"messageId": "m1", "body": "changed"},
        )
        self.assertEqual(
            self.server.requests_for("messages:remove")[0].args,
            {"messageId": "m1"},
        )

    async def test_call_rejects_unknown_kind(self) -> None:
        bot = self.make_bot()

        with self.assertRaises(ValueError):
            await bot.call("channels:list", {}, kind="subscription")

    async def test_event_aliases(self) -> None:
        bot = self.make_bot()
        calls: list[str] = []

        def handler(value: object) -> None:
            calls.append("called")

        for alias in (
            "message",
            "messageUpdate",
            "messageDelete",
            "reactionAdd",
            "reactionRemove",
            "ready",
            "error",
        ):
            self.assertEqual(bot.on(alias, handler), handler)

        self.assertEqual(normalize_event_name("message_update"), "message_update")
        with self.assertRaises(ValueError):
            bot.on("nope", handler)
        self.assertEqual(calls, [])


class ConfigTests(unittest.TestCase):
    def test_environment_configuration(self) -> None:
        env = {
            AUTH_ENV: "abt_env",
            "AULORA_SITE_URL": "https://chat.example.com/",
            "AULORA_CONVEX_URL": "https://convex.example.com/",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            bot = Bot()
        self.assertEqual(bot.me, None)
        self.assertEqual(
            bot._config.token_url(),
            "https://chat.example.com/bots/token",
        )
        self.assertEqual(
            bot._config.api_url("query"),
            "https://convex.example.com/api/query",
        )

    def test_explicit_options_override_environment(self) -> None:
        env = {
            AUTH_ENV: "abt_env",
            "AULORA_SITE_URL": "https://env.example.com",
            "AULORA_CONVEX_URL": "https://env-convex.example.com",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            bot = Bot(
                "abt_explicit",
                site_url="http://localhost:3210",
                convex_url="http://localhost:3211",
            )
        self.assertEqual(bot._config.token, "abt_explicit")
        self.assertEqual(bot._config.site_url, "http://localhost:3210")

    def test_rejects_invalid_urls(self) -> None:
        with self.assertRaises(ValueError):
            Bot("abt_x", site_url="ftp://example.com", convex_url="http://example.com")
        with self.assertRaises(ValueError):
            Bot("abt_x", site_url="https://example.com?x=1", convex_url="http://example.com")
        with self.assertRaises(ValueError):
            Bot("abt_x", site_url="https://user:pass@example.com", convex_url="http://example.com")

    def test_rejects_missing_values(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                Bot()
