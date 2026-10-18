"""A tiny local HTTP server that speaks the bot-facing Aulora/Convex API."""

from __future__ import annotations

import base64
import json
import struct
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping


@dataclass(frozen=True)
class RecordedRequest:
    kind: str
    path: str
    args: dict[str, Any]
    headers: dict[str, str]


@dataclass
class PollFailure:
    status: int = 500
    body: dict[str, Any] = field(default_factory=lambda: {"error": "server_error"})


def integer(value: int) -> dict[str, str]:
    """Encode an int the way Convex encodes Int64 in JSON."""
    raw = struct.pack("<q", value)
    return {"$integer": base64.b64encode(raw).decode("ascii")}


class FakeAuloraServer:
    """In-process fake for `/bots/token` and `/api/{query,mutation,action}`."""

    def __init__(
        self,
        *,
        token: str = "abt_test",
        expires_in_ms: int = 60 * 60 * 1000,
    ) -> None:
        self.token = token
        self.expires_in_ms = expires_in_ms
        self.lock = threading.Lock()

        self.token_requests: list[dict[str, str]] = []
        self.requests: list[RecordedRequest] = []
        self.poll_cursors: list[int | None] = []
        self.poll_queue: list[Any] = []
        self.toggle_results: list[Any] = []
        self.auth_failures = 0
        self.jwt_sequence = 0
        self.now_cursor = 10
        self.me = {"userId": "bot_1", "name": "Test Bot"}

        self._httpd = _Server(("127.0.0.1", 0), _Handler)
        self._httpd.fake = self
        self._thread = threading.Thread(
            target=lambda: self._httpd.serve_forever(poll_interval=0.02),
            daemon=True,
        )

    def start(self) -> "FakeAuloraServer":
        self._thread.start()
        return self

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=5)

    @property
    def port(self) -> int:
        return int(self._httpd.server_address[1])

    @property
    def site_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def convex_url(self) -> str:
        return self.site_url

    def requests_for(self, path: str) -> list[RecordedRequest]:
        with self.lock:
            return [request for request in self.requests if request.path == path]

    def queue_poll(self, response: Any) -> None:
        with self.lock:
            self.poll_queue.append(response)

    def queue_toggle(self, result: Any) -> None:
        with self.lock:
            self.toggle_results.append(result)

    def queue_events(self, events: list[dict[str, Any]], cursor: int | None = None) -> None:
        if cursor is None:
            cursor = self.now_cursor + 1
        self.queue_poll({"events": events, "cursor": cursor})

    def _handle_token(self, headers: Mapping[str, str], send: Any) -> None:
        with self.lock:
            self.token_requests.append(dict(headers))
        authorization = headers.get("Authorization")
        if authorization == "Bot abt_disabled":
            send(403, {"error": "bot_disabled"})
            return
        if authorization != f"Bot {self.token}":
            send(401, {"error": "invalid_token"})
            return
        with self.lock:
            self.jwt_sequence += 1
            jwt = f"jwt-{self.jwt_sequence}"
        send(
            200,
            {
                "token": jwt,
                "expiresAt": int(time.time() * 1000) + self.expires_in_ms,
                "userId": "bot_1",
                "botId": "botdoc_1",
                "name": "Test Bot",
            },
        )

    def _handle_convex(
        self,
        kind: str,
        path: str,
        args: dict[str, Any],
        headers: Mapping[str, str],
        send: Any,
    ) -> None:
        with self.lock:
            self.requests.append(RecordedRequest(kind, path, dict(args), dict(headers)))

        if path == "botEvents:poll":
            self._handle_poll(args, send)
            return
        if path == "channels:list":
            send(
                200,
                {
                    "status": "success",
                    "value": {
                        "page": [
                            {
                                "id": "c1",
                                "kind": "text",
                                "categoryId": None,
                                "name": "general",
                                "topic": "hello",
                                "archived": False,
                                "isPrivate": False,
                                "overrides": [],
                                "position": 1,
                                "hidden": False,
                                "muted": False,
                                "pinned": False,
                                "pinnedAt": None,
                            }
                        ],
                        "isDone": True,
                        "continueCursor": "",
                    },
                },
            )
            return
        if path == "messages:list":
            send(
                200,
                {
                    "status": "success",
                    "value": {
                        "page": [
                            {
                                "id": "m1",
                                "channelId": "c1",
                                "authorId": "u2",
                                "body": "hello",
                                "threadRootId": None,
                                "replyToId": None,
                                "attachmentIds": [],
                                "mentionUserIds": ["bot_1"],
                                "mentionChannelIds": [],
                                "mentionCategoryIds": [],
                                "editedAt": None,
                                "deletedAt": None,
                                "pinnedAt": None,
                                "replyCount": 0,
                                "lastReplyAt": None,
                                "createdAt": 1000,
                            }
                        ],
                        "isDone": True,
                        "continueCursor": "",
                    },
                },
            )
            return
        if path == "messages:send":
            send(200, {"status": "success", "value": "msg_new"})
            return
        if path in {"messages:edit", "messages:remove"}:
            send(200, {"status": "success", "value": None})
            return
        if path == "reactions:toggle":
            with self.lock:
                result = self.toggle_results.pop(0) if self.toggle_results else {"added": True}
            send(200, {"status": "success", "value": result})
            return
        if path == "members:list":
            send(
                200,
                {
                    "status": "success",
                    "value": [
                        {
                            "id": "mem_bot",
                            "userId": "bot_1",
                            "nickname": "Test Bot",
                            "accountName": "Test Bot",
                            "roleIds": [],
                            "joinedAt": 1,
                            "timeoutUntil": None,
                            "avatarUrl": None,
                            "isBot": True,
                        }
                    ],
                },
            )
            return
        if path == "test:error":
            send(
                200,
                {
                    "status": "error",
                    "errorMessage": "Missing permission",
                    "errorData": {"code": "forbidden", "detail": "no"},
                },
            )
            return
        if path == "test:authfail":
            with self.lock:
                self.auth_failures += 1
                first = self.auth_failures == 1
            if first:
                send(
                    200,
                    {
                        "status": "error",
                        "errorMessage": "Unauthenticated",
                        "errorData": {},
                    },
                )
            else:
                send(200, {"status": "success", "value": "ok"})
            return
        if path == "test:http500":
            send(500, {"error": "boom"})
            return
        if path == "test:int64":
            send(200, {"status": "success", "value": {"n": integer(-2)}})
            return
        if path == "test:429":
            send(429, {"error": "rate_limited"})
            return
        send(200, {"status": "success", "value": None})

    def _handle_poll(self, args: Mapping[str, Any], send: Any) -> None:
        cursor = args.get("cursor")
        with self.lock:
            self.poll_cursors.append(cursor)
            queued = self.poll_queue.pop(0) if self.poll_queue and cursor is not None else None
            now_cursor = self.now_cursor

        if cursor is None:
            send(
                200,
                {
                    "status": "success",
                    "value": {"events": [], "cursor": now_cursor, "me": self.me},
                },
            )
            return
        if isinstance(queued, PollFailure):
            send(queued.status, queued.body)
            return
        if queued is None:
            queued = {"events": [], "cursor": max(now_cursor, int(cursor))}
        if not isinstance(queued, Mapping):
            send(500, {"error": "bad_script"})
            return
        response = dict(queued)
        response.setdefault("events", [])
        response.setdefault("cursor", max(now_cursor, int(cursor)))
        response.setdefault("me", self.me)
        send(200, {"status": "success", "value": response})


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    fake: FakeAuloraServer


class _Handler(BaseHTTPRequestHandler):
    server: _Server

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        headers = {key: value for key, value in self.headers.items()}

        def send(status: int, body: Any) -> None:
            encoded = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        if self.path == "/bots/token":
            self.server.fake._handle_token(headers, send)
            return
        if self.path in ("/api/query", "/api/mutation", "/api/action"):
            kind = self.path.rsplit("/", 1)[-1]
            path = payload.get("path")
            args = payload.get("args")
            self.server.fake._handle_convex(
                kind,
                str(path) if path is not None else "",
                args if isinstance(args, dict) else {},
                headers,
                send,
            )
            return
        send(404, {"error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:
        return
