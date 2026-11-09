import json
import pathlib
import time
import unittest

from app.models import ALLOWED_MODELS, ModelState, is_allowed_model
from app.tokens import derive_key, sign_claims, verify_token

SECRET = "synthetic-transcriber-secret"
FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "audio-token-vector.json"


class TokenTests(unittest.TestCase):
    def test_round_trip_binds_session_speaker_and_expiry(self):
        token = sign_claims(
            SECRET,
            sid="session-1",
            cid="call-1",
            sub="user:member-1",
            start=1_700_000_000_000,
            exp=int(time.time()) + 60,
        )
        claims = verify_token(SECRET, token)
        self.assertIsNotNone(claims)
        assert claims is not None
        self.assertEqual(claims["sid"], "session-1")
        self.assertEqual(claims["cid"], "call-1")
        self.assertEqual(claims["sub"], "user:member-1")
        self.assertEqual(claims["start"], 1_700_000_000_000)

    def test_shared_cross_language_vector(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        claims = fixture["claims"]
        # Key derivation must match Convex: SHA-256(secret || NUL || context).
        self.assertEqual(
            derive_key(fixture["secret"]),
            __import__("hashlib").sha256(
                fixture["secret"].encode() + b"\x00" + b"aulora-audio-token-v1"
            ).digest(),
        )
        minted = sign_claims(
            fixture["secret"],
            sid=claims["sid"],
            cid=claims["cid"],
            sub=claims["sub"],
            start=claims["start"],
            iat=claims["iat"],
            exp=claims["exp"],
        )
        self.assertEqual(minted, fixture["token"])
        verified = verify_token(fixture["secret"], fixture["token"], now=claims["iat"] + 1)
        self.assertIsNotNone(verified)
        assert verified is not None
        self.assertEqual(verified["start"], claims["start"])

    def test_rejects_wrong_secret_tampering_and_expiry(self):
        token = sign_claims(
            SECRET,
            sid="s",
            cid="c",
            sub="user:u",
            start=1_700_000_000_000,
            exp=int(time.time()) + 60,
        )
        self.assertIsNone(verify_token("another-secret", token))
        self.assertIsNone(verify_token(SECRET, token[:-2] + "aa"))
        self.assertIsNone(verify_token(SECRET, "not-a-token"))
        expired = sign_claims(
            SECRET, sid="s", cid="c", sub="user:u", start=1_700_000_000_000, exp=1
        )
        self.assertIsNone(verify_token(SECRET, expired, now=100))

    def test_rejects_empty_secret_and_malformed_payload(self):
        self.assertIsNone(verify_token("", "a.b"))
        self.assertIsNone(verify_token(SECRET, "a.b"))
        self.assertIsNone(verify_token(SECRET, ""))


class ModelTests(unittest.TestCase):
    def test_only_allowlisted_ids_are_downloadable(self):
        self.assertTrue(is_allowed_model("large-v3-turbo"))
        for model in ALLOWED_MODELS:
            self.assertTrue(is_allowed_model(model))
        self.assertFalse(is_allowed_model("https://example.com/model"))
        self.assertFalse(is_allowed_model("large-v3"))
        self.assertFalse(is_allowed_model(""))

    def test_state_transitions(self):
        state = ModelState()
        self.assertEqual(state.snapshot()["status"], "not_installed")
        state.start("base")
        self.assertEqual(state.snapshot()["status"], "downloading")
        self.assertIsNone(state.snapshot()["progress"])
        state.ready("base")
        snapshot = state.snapshot()
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["progress"], 100)
        state.fail("base", "x" * 1000)
        self.assertEqual(state.snapshot()["status"], "error")
        self.assertLessEqual(len(state.snapshot()["error"]), 300)


if __name__ == "__main__":
    unittest.main()
