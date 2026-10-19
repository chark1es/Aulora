"""Configuration resolution and URL construction.

Every outbound URL is built here from values that were validated at
construction time. The rest of the package never interpolates configuration
into a request path, which keeps request targets predictable and testable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

AUTH_EXCHANGE_PATH = "/bots/token"
API_PREFIX = "/api"
API_KINDS = ("query", "mutation", "action")

AUTH_ENV_VAR = "AULORA_TOKEN"
SITE_URL_ENV = "AULORA_SITE_URL"
CONVEX_URL_ENV = "AULORA_CONVEX_URL"


@dataclass(frozen=True, repr=False)
class Config:
    """Validated connection settings for one bot.

    `token` is never included in the representation so accidental logging of a
    config object cannot leak the API token.
    """

    token: str
    site_url: str
    convex_url: str

    @classmethod
    def resolve(
        cls,
        token: str | None = None,
        site_url: str | None = None,
        convex_url: str | None = None,
    ) -> "Config":
        """Build a config from explicit values, falling back to the environment."""
        return cls(
            token=_token(_option_or_env(token, AUTH_ENV_VAR), AUTH_ENV_VAR),
            site_url=_base_url(_option_or_env(site_url, SITE_URL_ENV), SITE_URL_ENV),
            convex_url=_base_url(_option_or_env(convex_url, CONVEX_URL_ENV), CONVEX_URL_ENV),
        )

    def token_url(self) -> str:
        """The Convex site endpoint that exchanges an API token for a JWT."""
        return f"{self.site_url}{AUTH_EXCHANGE_PATH}"

    def api_url(self, kind: str) -> str:
        """The Convex HTTP endpoint for a function kind (`query`/`mutation`/`action`)."""
        if kind not in API_KINDS:
            raise ValueError(f"Unknown Convex function kind: {kind!r}")
        return f"{self.convex_url}{API_PREFIX}/{kind}"

    def __repr__(self) -> str:
        return f"Config(site_url={self.site_url!r}, convex_url={self.convex_url!r})"


def _option_or_env(value: str | None, env_name: str) -> str | None:
    return value if value is not None else os.environ.get(env_name)


def _token(value: str | None, env_name: str) -> str:
    if value is None:
        raise ValueError(f"Missing bot token: pass token= or set {env_name}")
    token = value.strip()
    if not token:
        raise ValueError(f"Empty bot token: pass token= or set {env_name}")
    # A token is placed in an Authorization header, so refuse anything that
    # could split the header rather than letting urllib make sense of it.
    if "\r" in token or "\n" in token:
        raise ValueError("Bot token must not contain line breaks")
    return token


def _base_url(value: str | None, env_name: str) -> str:
    if value is None:
        raise ValueError(f"Missing URL: pass it explicitly or set {env_name}")
    text = value.strip()
    if not text:
        raise ValueError(f"Empty URL: set {env_name}")
    if "\r" in text or "\n" in text:
        raise ValueError(f"{env_name} must not contain line breaks")

    parts = urlsplit(text)
    if parts.scheme not in ("http", "https"):
        raise ValueError(f"{env_name} must start with http:// or https://")
    if not parts.netloc:
        raise ValueError(f"{env_name} must include a host")
    if parts.username is not None or parts.password is not None:
        raise ValueError(f"{env_name} must not include credentials")
    if parts.query or parts.fragment:
        raise ValueError(f"{env_name} must not include a query or fragment")

    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))
