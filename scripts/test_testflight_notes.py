"""Test di scripts/testflight_notes.py contro un App Store Connect finto, con una chiave generata qui.

python3 -m unittest scripts/test_testflight_notes.py
"""

import base64
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

SCRIPT = Path(__file__).resolve().parent / "testflight_notes.py"
sys.path.insert(0, str(SCRIPT.parent))
import testflight_notes  # noqa: E402

KEY = ec.generate_private_key(ec.SECP256R1())
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class FakeConnect(http.server.BaseHTTPRequestHandler):
    """App Store Connect finto: la build compare dopo `appear_after` richieste; registra ogni chiamata."""

    calls: list = []
    appear_after = 0
    localizations: list = []
    seen_builds = 0
    fail_notes = False

    def log_message(self, *args):
        pass

    def authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        head, payload, signature = header[7:].split(".")
        raw = b64url_decode(signature)
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        try:
            KEY.public_key().verify(der, f"{head}.{payload}".encode(), ec.ECDSA(hashes.SHA256()))
        except Exception:
            return False
        claims = json.loads(b64url_decode(payload))
        return claims["aud"] == "appstoreconnect-v1" and claims["iss"] == "issuer" and json.loads(b64url_decode(head))["kid"] == "KEY1"

    def reply(self, status, body=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if body is not None:
            self.wfile.write(json.dumps(body).encode())

    def handle_any(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        FakeConnect.calls.append((self.command, self.path, body))
        if not self.authorized():
            return self.reply(401, {"errors": [{"title": "Unauthorized"}]})
        if self.path.startswith("/v1/apps?"):
            return self.reply(200, {"data": [{"id": "APP1"}]})
        if self.path.startswith("/v1/builds?"):
            FakeConnect.seen_builds += 1
            found = FakeConnect.seen_builds > FakeConnect.appear_after
            return self.reply(200, {"data": [{"id": "BUILD1"}] if found else []})
        if self.path == "/v1/builds/BUILD1/betaBuildLocalizations":
            return self.reply(200, {"data": FakeConnect.localizations})
        if self.path.startswith("/v1/betaBuildLocalizations"):
            # Come App Store Connect: un attributo che la risorsa non ha è un 409 con dettaglio e campo.
            attributes = (body or {}).get("data", {}).get("attributes", {})
            unknown = sorted(set(attributes) - {"locale", "whatsNew"}) or (["x"] if FakeConnect.fail_notes else [])
            if unknown:
                return self.reply(
                    409,
                    {
                        "errors": [
                            {
                                "title": "The provided entity includes an unknown attribute",
                                "detail": f"'{unknown[0]}' is not an attribute on the resource 'betaBuildLocalizations'",
                                "source": {"pointer": f"/data/attributes/{unknown[0]}"},
                            }
                        ]
                    },
                )
        if self.command in ("PATCH", "POST"):
            return self.reply(200, {"data": {}})
        return self.reply(404, {"errors": [{"title": "Not found"}]})

    do_GET = do_PATCH = do_POST = handle_any


class TestFlightNotesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), FakeConnect)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeConnect.calls = []
        FakeConnect.appear_after = 0
        FakeConnect.seen_builds = 0
        FakeConnect.localizations = []
        FakeConnect.fail_notes = False
        self.tmp = tempfile.TemporaryDirectory()
        self.notes = Path(self.tmp.name) / "note.txt"
        self.notes.write_text("Novità:\n\n• Battito di oggi.\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, **extra):
        env = {
            **os.environ,
            "ASC_API": f"http://127.0.0.1:{self.server.server_port}",
            "ASC_API_KEY_ID": "KEY1",
            "ASC_API_ISSUER_ID": "issuer",
            "ASC_API_KEY_P8": base64.b64encode(PEM).decode(),
            "TESTFLIGHT_POLL_SECONDS": "0",
            "TESTFLIGHT_WAIT_SECONDS": "5",
            **extra,
        }
        args = ["--bundle-id", "com.example.app", "--version", "0.2.0", "--build", "263271034", "--notes-file", str(self.notes)]
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, capture_output=True, text=True, check=False)

    def test_creates_the_italian_notes_when_the_build_has_none(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        post = [c for c in FakeConnect.calls if c[0] == "POST"]
        self.assertEqual(len(post), 1)
        data = post[0][2]["data"]
        self.assertEqual(data["attributes"], {"locale": "it", "whatsNew": "Novità:\n\n• Battito di oggi."})
        self.assertEqual(data["relationships"]["build"]["data"]["id"], "BUILD1")
        self.assertIn("filter%5Bversion%5D=263271034", FakeConnect.calls[1][1])
        self.assertIn("filter%5BpreReleaseVersion.version%5D=0.2.0", FakeConnect.calls[1][1])

    def test_updates_every_existing_language(self):
        FakeConnect.localizations = [{"id": "L1", "attributes": {"locale": "it"}}, {"id": "L2", "attributes": {"locale": "en-US"}}]
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        patches = [c for c in FakeConnect.calls if c[0] == "PATCH"]
        self.assertEqual([p[1] for p in patches], ["/v1/betaBuildLocalizations/L1", "/v1/betaBuildLocalizations/L2"])
        self.assertIn("it, en-US", result.stdout)

    def test_waits_for_the_build_to_appear(self):
        FakeConnect.appear_after = 2
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(FakeConnect.seen_builds, 3)

    def test_gives_up_with_a_clear_message_when_the_build_never_appears(self):
        FakeConnect.appear_after = 10_000
        result = self.run_script(TESTFLIGHT_WAIT_SECONDS="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non è comparsa su App Store Connect", result.stderr)

    def test_says_which_secret_is_missing(self):
        result = self.run_script(ASC_API_KEY_P8="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ASC_API_KEY_P8", result.stderr)

    def test_cuts_the_notes_to_the_testflight_limit(self):
        self.notes.write_text("x" * 5000, encoding="utf-8")
        self.run_script()
        post = [c for c in FakeConnect.calls if c[0] == "POST"][0]
        self.assertEqual(len(post[2]["data"]["attributes"]["whatsNew"]), testflight_notes.MAX_NOTES)

    def test_the_token_is_short_lived(self):
        jwt = testflight_notes.token("KEY1", "issuer", PEM, now=1_000)
        claims = json.loads(b64url_decode(jwt.split(".")[1]))
        self.assertEqual(claims["exp"] - claims["iat"], 15 * 60)

    def test_an_api_error_says_which_field(self):
        FakeConnect.fail_notes = True
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HTTP 409 The provided entity includes an unknown attribute", result.stderr)
        self.assertIn("(/data/attributes/x)", result.stderr)

if __name__ == "__main__":
    unittest.main()
