"""Prova scripts/update-ha-app.sh contro un finto GitHub locale e un finto comando `ha`.

Non serve rete ne' un Supervisor. Uso: python3 -m unittest scripts/test_update_ha_app.py
"""
import hashlib
import http.server
import io
import os
import subprocess
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "update-ha-app.sh"
TOKEN = "synthetic-token-123"
REPO = "owner/repo"


def make_pack(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class FakeGitHub(http.server.BaseHTTPRequestHandler):
    tag = "ha-app-7"
    pack = b""
    checksum = ""
    seen_auth = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        FakeGitHub.seen_auth.append(self.headers.get("Authorization"))
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_response(401)
            self.end_headers()
            return
        base = f"http://127.0.0.1:{self.server.server_port}/repos/{REPO}/releases"
        if self.path == f"/repos/{REPO}/releases/latest":
            body = (
                '{\n  "url": "%s/1",\n  "tag_name": "%s",\n  "assets": [\n'
                '    {\n      "url": "%s/assets/11",\n      "id": 11,\n      "node_id": "MDEyOlJlbGVhc2VBc3NldDEx",\n'
                '      "name": "ringlife-ha-app.tar.gz",\n      "label": null\n    },\n'
                '    {\n      "url": "%s/assets/12",\n      "id": 12,\n      "node_id": "MDEyOlJlbGVhc2VBc3NldDEy",\n'
                '      "name": "ringlife-ha-app.tar.gz.sha256",\n      "label": null\n    }\n  ]\n}'
            ) % (base, FakeGitHub.tag, base, base)
            self.reply(body.encode())
        elif self.path.endswith("/assets/11"):
            self.reply(FakeGitHub.pack)
        elif self.path.endswith("/assets/12"):
            self.reply(f"{FakeGitHub.checksum}  ringlife-ha-app.tar.gz\n".encode())
        else:
            self.send_response(404)
            self.end_headers()

    def reply(self, body):
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


GOOD_FILES = {
    "config.yaml": 'name: RingLife\nversion: "0.1.2"\n',
    "Dockerfile": "FROM x\n",
    "run.sh": "#!/bin/sh\n",
    "ringlife-backend.jar": "jar",
    "icon.png": "png",
    "logo.png": "png",
}


class UpdateScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), FakeGitHub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        self.app = tmp / "addons-ringlife"
        self.app.mkdir()
        (self.app / "old-file").write_text("old")
        self.token = tmp / "token"
        self.token.write_text(TOKEN + "\n")
        self.calls = tmp / "ha-calls.txt"
        ha = tmp / "bin" / "ha"
        ha.parent.mkdir()
        ha.write_text(
            '#!/bin/sh\n[ "$2" = "--help" ] && exit 0\n'
            # `info`: il Supervisor mostra la versione nuova solo dopo HA_SEEN_AFTER richieste.
            'if [ "$2" = info ]; then n=$(cat "$HA_COUNTER" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HA_COUNTER"; '
            'if [ "$n" -gt "${HA_SEEN_AFTER:-0}" ]; then echo "version_latest: ${HA_LATEST:-0.1.2}"; else echo "version_latest: 0.1.0"; fi; exit 0; fi\n'
            'echo "$*" >> "$HA_CALLS"\n[ "${HA_UPDATE_FAILS:-0}" = 1 ] && [ "$2" = update ] && exit 1\nexit 0\n'
        )
        ha.chmod(0o755)
        self.set_release(GOOD_FILES)

    def tearDown(self):
        self.tmp.cleanup()

    def set_release(self, files, tag="ha-app-7", checksum=None):
        FakeGitHub.pack = make_pack(files)
        FakeGitHub.checksum = checksum or hashlib.sha256(FakeGitHub.pack).hexdigest()
        FakeGitHub.tag = tag

    def run_script(self, *args, **extra):
        env = {
            "PATH": f"{Path(self.tmp.name) / 'bin'}:{os.environ['PATH']}",
            "RINGLIFE_API": f"http://127.0.0.1:{self.server.server_port}",
            "RINGLIFE_REPO": REPO,
            "RINGLIFE_TOKEN_FILE": str(self.token),
            "RINGLIFE_APP_DIR": str(self.app),
            "HA_CALLS": str(self.calls),
            "HA_COUNTER": str(Path(self.tmp.name) / "info-counter"),
            "RINGLIFE_POLL_SECONDS": "1",
            "RINGLIFE_WAIT_SECONDS": "5",
        }
        env.update(extra)
        return subprocess.run(["sh", str(SCRIPT), *args], env=env, capture_output=True, text=True, check=False)

    def ha_calls(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def test_installs_the_release_and_asks_the_supervisor_to_update(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / "config.yaml").read_text(), 'name: RingLife\nversion: "0.1.2"\n')
        self.assertEqual((self.app / ".release-tag").read_text(), "ha-app-7")
        self.assertFalse((self.app / "old-file").exists())
        self.assertEqual(self.ha_calls(), ["store reload", "apps update local_ringlife"])

    def test_does_nothing_when_already_up_to_date_unless_forced(self):
        self.run_script()
        self.calls.unlink()
        result = self.run_script()
        self.assertIn("Gia' aggiornato", result.stdout)
        self.assertEqual(self.ha_calls(), [])
        self.run_script("--force")
        self.assertEqual(self.ha_calls(), ["store reload", "apps update local_ringlife"])

    def test_falls_back_to_rebuild_when_there_is_no_update(self):
        self.run_script(HA_UPDATE_FAILS="1")
        self.assertEqual(self.ha_calls(), ["store reload", "apps update local_ringlife", "apps rebuild local_ringlife"])

    def test_a_wrong_checksum_installs_nothing(self):
        self.set_release(GOOD_FILES, checksum="0" * 64)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.app / "old-file").exists())
        self.assertEqual(self.ha_calls(), [])

    def test_an_incomplete_package_installs_nothing(self):
        self.set_release({"config.yaml": "x"})
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Pacchetto incompleto", result.stderr)
        self.assertTrue((self.app / "old-file").exists())

    def test_a_wrong_token_fails_without_touching_the_app(self):
        self.token.write_text("wrong")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.app / "old-file").exists())

    def test_without_a_token_file_it_asks_without_authentication(self):
        # Il GitHub finto risponde solo con il token: senza, come un repository privato, non trova la release.
        self.token.unlink()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("senza autenticazione", result.stdout)
        self.assertIn("Nessuna release trovata", result.stderr)
        self.assertTrue((self.app / "old-file").exists())

    def test_waits_until_the_supervisor_sees_the_new_version(self):
        result = self.run_script(HA_SEEN_AFTER="2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.ha_calls(), ["store reload", "apps update local_ringlife"])

    def test_gives_up_with_a_clear_message_if_the_supervisor_never_sees_it(self):
        result = self.run_script(HA_SEEN_AFTER="999")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non vede ancora la versione 0.1.2", result.stderr)
        self.assertEqual(self.ha_calls(), ["store reload"])
        # Non segnata come installata: rilanciato senza --force, lo script riprova.
        self.assertFalse((self.app / ".release-tag").exists())
        self.calls.unlink()
        result = self.run_script(HA_SEEN_AFTER="0", HA_COUNTER=str(Path(self.tmp.name) / "other-counter"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.ha_calls(), ["store reload", "apps update local_ringlife"])
        self.assertEqual((self.app / ".release-tag").read_text(), "ha-app-7")

    def test_falls_back_to_the_apps_reload_without_the_store_command(self):
        ha = Path(self.tmp.name) / "bin" / "ha"
        ha.write_text('#!/bin/sh\n[ "$1" = store ] && exit 1\n' + ha.read_text().split("\n", 1)[1])
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.ha_calls(), ["apps reload", "apps update local_ringlife"])

    def test_the_default_folder_follows_local_apps_when_it_exists(self):
        text = SCRIPT.read_text()
        self.assertIn("[ -d /local_apps ]", text)
        self.assertIn("default_dir=/local_apps/ringlife", text)
        self.assertIn("default_dir=/addons/ringlife", text)

    def test_the_token_never_appears_in_the_output(self):
        result = self.run_script()
        self.assertNotIn(TOKEN, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
