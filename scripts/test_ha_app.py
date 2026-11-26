"""Controlli sull'app locale di Home Assistant (ha-app/ringlife) che non richiedono Docker ne' un Supervisor.

Non provano la build dell'immagine: quella va verificata sul server.
Uso: python3 -m unittest scripts/test_ha_app.py
"""
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "ha-app" / "ringlife"

# Sostituti di bashio: leggono le opzioni da OPT_<nome> e scrivono i log su un file.
BASHIO_STUB = """
bashio::config() {
    local var="OPT_$1"
    if [ -z "${!var+x}" ]; then printf 'null'; else printf '%s' "${!var}"; fi
}
bashio::log.info() { echo "INFO: $*" >> "$LOG_FILE"; }
bashio::log.warning() { echo "WARNING: $*" >> "$LOG_FILE"; }
# Il servizio MQTT del Supervisor: MQTT_STUB=off lo simula assente, altrimenti valori sintetici.
bashio::services.available() { [ "${MQTT_STUB:-on}" = "on" ]; }
bashio::services() { printf 'synthetic-%s' "$2"; }
"""

# Al posto di java: stampa gli argomenti e le variabili che il backend riceverebbe.
FAKE_JAVA = """#!/bin/sh
echo "ARGS: $*"
env | grep -E '^(RINGLIFE_|PORT=|MQTT_)' | sort
"""


def load_config():
    return yaml.safe_load((APP / "config.yaml").read_text(encoding="utf-8"))


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.config = load_config()

    def test_has_the_required_keys(self):
        for key in ("name", "version", "slug", "description", "arch"):
            self.assertIn(key, self.config)
        self.assertEqual(self.config["slug"], "ringlife")
        self.assertRegex(self.config["slug"], r"^[a-z0-9_-]+$")

    def test_only_builds_for_the_server_architecture(self):
        self.assertEqual(self.config["arch"], ["amd64"])

    def test_names_the_prebuilt_image_without_a_tag(self):
        # Home Assistant pulls <image>:<version>; the public workflow builds exactly this name.
        self.assertEqual(self.config["image"], "ghcr.io/cristianpale/ringlife")
        workflow = (ROOT / "public" / ".github" / "workflows" / "ha-image.yml").read_text(encoding="utf-8")
        self.assertIn('image="ghcr.io/${OWNER,,}/ringlife"', workflow)

    def test_the_public_repository_file_has_a_name(self):
        repository = yaml.safe_load((ROOT / "public" / "repository.yaml").read_text(encoding="utf-8"))
        self.assertEqual(repository["name"], "RingLife")

    def test_starts_after_home_assistant_and_stops_for_backups(self):
        self.assertEqual(self.config["startup"], "application")
        self.assertEqual(self.config["backup"], "cold")

    def test_every_option_has_a_schema_entry_and_the_other_way_round(self):
        self.assertEqual(set(self.config["options"]), set(self.config["schema"]))

    def test_default_options_satisfy_their_own_schema(self):
        for key, value in self.config["options"].items():
            rule = self.config["schema"][key]
            match = re.fullmatch(r"int\((\d+),(\d+)\)", rule)
            if match:
                self.assertTrue(int(match.group(1)) <= value <= int(match.group(2)), key)
            elif rule.startswith("str") or rule.startswith("password"):
                self.assertIsInstance(value, str, key)

    def test_the_pairing_secret_is_a_password_and_optional(self):
        self.assertEqual(self.config["schema"]["pairing_secret"], "password?")
        self.assertEqual(self.config["options"]["pairing_secret"], "")

    def test_the_watchdog_checks_the_health_endpoint_on_the_published_port(self):
        watchdog = self.config["watchdog"]
        self.assertTrue(watchdog.endswith("/actuator/health"))
        port = re.search(r"\[PORT:(\d+)\]", watchdog).group(1)
        self.assertIn(f"{port}/tcp", self.config["ports"])

    def test_no_secret_is_committed(self):
        self.assertEqual(self.config["options"]["pairing_secret"], "")

    def test_does_not_ask_for_permissions_it_does_not_use_yet(self):
        for key in ("hassio_api", "host_network", "privileged", "full_access"):
            self.assertNotIn(key, self.config)
        self.assertNotIn("ingress", self.config)

    def test_asks_for_the_mqtt_service_and_nothing_else(self):
        self.assertEqual(self.config["services"], ["mqtt:need"])

    def test_asks_for_the_home_assistant_api_to_read_the_weather(self):
        self.assertIs(self.config["homeassistant_api"], True)

    def test_the_weather_entity_is_optional_and_not_committed(self):
        self.assertEqual(self.config["schema"]["weather_entity"], "str?")
        self.assertEqual(self.config["options"]["weather_entity"], "")

    def test_the_uv_entity_is_optional_and_not_committed(self):
        self.assertEqual(self.config["schema"]["uv_entity"], "str?")
        self.assertEqual(self.config["options"]["uv_entity"], "")

    def test_the_apns_options_are_optional_the_key_is_a_password_and_nothing_is_committed(self):
        self.assertEqual(self.config["schema"]["apns_key"], "password?")
        self.assertEqual(self.config["schema"]["apns_key_id"], "str?")
        self.assertEqual(self.config["schema"]["apns_team_id"], "str?")
        self.assertEqual(self.config["schema"]["apns_topic"], "str?")
        for option in ("apns_key", "apns_key_id", "apns_team_id", "apns_topic"):
            self.assertEqual(self.config["options"][option], "", option)


class DockerfileTest(unittest.TestCase):
    def setUp(self):
        self.text = (APP / "Dockerfile").read_text(encoding="utf-8")

    def test_uses_the_same_java_as_the_backend(self):
        pom = (ROOT / "backend" / "pom.xml").read_text(encoding="utf-8")
        java = re.search(r"<java.version>(\d+)</java.version>", pom).group(1)
        self.assertIn(f"eclipse-temurin:{java}-jre", self.text)

    def test_copies_the_jar_and_runs_the_start_script(self):
        self.assertIn("COPY ringlife-backend.jar", self.text)
        self.assertIn("COPY THIRD-PARTY-LICENSES.txt", self.text)
        self.assertIn("COPY run.sh /run.sh", self.text)
        self.assertIn('CMD [ "/run.sh" ]', self.text)

    def test_the_base_image_comes_from_the_build_argument(self):
        self.assertRegex(self.text, r"ARG BUILD_FROM=")
        self.assertIn("FROM ${BUILD_FROM}", self.text)


class RunScriptTest(unittest.TestCase):
    def run_script(self, mqtt=True, **options):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            stub = tmp / "stub.sh"
            stub.write_text(BASHIO_STUB, encoding="utf-8")
            java = tmp / "java"
            java.write_text(FAKE_JAVA, encoding="utf-8")
            java.chmod(java.stat().st_mode | stat.S_IEXEC)
            log = tmp / "log.txt"
            env = {
                "PATH": os.environ["PATH"],
                "RINGLIFE_JAVA": str(java),
                "LOG_FILE": str(log),
                "MQTT_STUB": "on" if mqtt else "off",
            }
            env.update({f"OPT_{name}": str(value) for name, value in options.items()})
            result = subprocess.run(
                ["bash", "-c", f"source {stub}; source {APP / 'run.sh'}"],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            logs = log.read_text(encoding="utf-8") if log.exists() else ""
            return result, logs

    def test_maps_the_options_to_the_environment_of_the_backend(self):
        result, _ = self.run_script(
            pairing_secret="s3cr3t-synthetic", sleep_goal_minutes=450, steps_goal=9000, timezone="Europe/London"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RINGLIFE_PAIRING_SECRET=s3cr3t-synthetic", result.stdout)
        self.assertIn("RINGLIFE_GOALS_SLEEP_MINUTES=450", result.stdout)
        self.assertIn("RINGLIFE_GOALS_STEPS=9000", result.stdout)
        self.assertIn("RINGLIFE_ZONE=Europe/London", result.stdout)

    def test_passes_the_weather_entity_and_treats_a_missing_one_as_empty(self):
        result, _ = self.run_script(weather_entity="weather.synthetic", sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_WEATHER_ENTITY=weather.synthetic", result.stdout)
        result, _ = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_WEATHER_ENTITY=\n", result.stdout + "\n")
        self.assertNotIn("RINGLIFE_WEATHER_ENTITY=null", result.stdout)

    def test_passes_the_uv_entity_and_treats_a_missing_one_as_empty(self):
        result, _ = self.run_script(uv_entity="sensor.synthetic_uv", sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_WEATHER_UV_ENTITY=sensor.synthetic_uv", result.stdout)
        result, _ = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_WEATHER_UV_ENTITY=\n", result.stdout + "\n")
        self.assertNotIn("RINGLIFE_WEATHER_UV_ENTITY=null", result.stdout)

    def test_passes_the_apns_options_and_treats_missing_ones_as_empty(self):
        result, logs = self.run_script(
            apns_key="synthetic-p8-body",  # gitleaks:allow (synthetic value)
            apns_key_id="SYNTHKEY01",
            apns_team_id="SYNTHTEAM1",
            apns_topic="com.example.synthetic",
            sleep_goal_minutes=480,
            steps_goal=8000,
            timezone="Europe/Rome",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RINGLIFE_APNS_KEY=synthetic-p8-body", result.stdout)  # gitleaks:allow (synthetic value)
        self.assertIn("RINGLIFE_APNS_KEY_ID=SYNTHKEY01", result.stdout)
        self.assertIn("RINGLIFE_APNS_TEAM_ID=SYNTHTEAM1", result.stdout)
        self.assertIn("RINGLIFE_APNS_TOPIC=com.example.synthetic", result.stdout)
        self.assertIn("Push cifrate attive", logs)
        result, logs = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        for name in ("RINGLIFE_APNS_KEY", "RINGLIFE_APNS_KEY_ID", "RINGLIFE_APNS_TEAM_ID", "RINGLIFE_APNS_TOPIC"):
            self.assertIn(f"{name}=\n", result.stdout + "\n")
            self.assertNotIn(f"{name}=null", result.stdout)
        self.assertIn("Push cifrate spente", logs)

    def test_the_apns_key_never_reaches_the_log(self):
        _, logs = self.run_script(
            apns_key="synthetic-p8-body", apns_key_id="SYNTHKEY01", apns_team_id="SYNTHTEAM1",  # gitleaks:allow (synthetic value)
            sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome",
        )
        self.assertNotIn("synthetic-p8-body", logs)  # gitleaks:allow (synthetic value)

    def test_keeps_the_data_in_the_persistent_folder_and_the_port_fixed(self):
        result, _ = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_DB_PATH=/data/ringlife.sqlite", result.stdout)
        self.assertIn("PORT=8080", result.stdout)

    def test_limits_the_heap_and_exits_on_out_of_memory(self):
        result, _ = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("-Xmx512m", result.stdout)
        self.assertIn("-XX:+ExitOnOutOfMemoryError", result.stdout)
        self.assertIn("-jar /opt/ringlife/ringlife-backend.jar", result.stdout)

    def test_an_empty_secret_disables_registration_and_says_so(self):
        result, logs = self.run_script(pairing_secret="", sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("RINGLIFE_PAIRING_SECRET=\n", result.stdout + "\n")
        self.assertIn("disattivata", logs)

    def test_a_missing_secret_is_treated_as_empty_not_as_the_word_null(self):
        result, logs = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertNotIn("RINGLIFE_PAIRING_SECRET=null", result.stdout)
        self.assertIn("disattivata", logs)

    def test_takes_the_mqtt_connection_from_the_supervisor(self):
        result, logs = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertIn("MQTT_HOST=synthetic-host", result.stdout)
        self.assertIn("MQTT_PORT=synthetic-port", result.stdout)
        self.assertIn("MQTT_USERNAME=synthetic-username", result.stdout)
        self.assertIn("MQTT_PASSWORD=synthetic-password", result.stdout)
        self.assertIn("MQTT collegato", logs)

    def test_starts_with_mqtt_off_when_the_service_is_missing(self):
        result, logs = self.run_script(mqtt=False, sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("MQTT_HOST", result.stdout)
        self.assertIn("-jar /opt/ringlife/ringlife-backend.jar", result.stdout)
        self.assertIn("spente", logs)

    def test_the_mqtt_password_never_reaches_the_log(self):
        _, logs = self.run_script(sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome")
        self.assertNotIn("synthetic-password", logs)
        self.assertNotIn("synthetic-username", logs)

    def test_the_secret_never_reaches_the_log(self):
        _, logs = self.run_script(
            pairing_secret="s3cr3t-synthetic", sleep_goal_minutes=480, steps_goal=8000, timezone="Europe/Rome"
        )
        self.assertNotIn("s3cr3t-synthetic", logs)
        self.assertIn("attiva", logs)


class PackagingTest(unittest.TestCase):
    def test_the_package_script_is_valid_shell(self):
        result = subprocess.run(["sh", "-n", str(ROOT / "scripts" / "package-ha-app.sh")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_start_script_is_valid_bash_and_executable(self):
        result = subprocess.run(["bash", "-n", str(APP / "run.sh")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(os.access(APP / "run.sh", os.X_OK))

    def test_every_file_the_script_copies_exists(self):
        for name in ("config.yaml", "Dockerfile", "run.sh", "DOCS.md"):
            self.assertTrue((APP / name).is_file(), name)
        self.assertTrue((ROOT / "CHANGELOG.md").is_file())

    def test_the_docs_describe_every_option(self):
        docs = (APP / "DOCS.md").read_text(encoding="utf-8")
        for option in load_config()["options"]:
            self.assertIn(f"`{option}`", docs)

    def test_the_jar_is_not_versioned(self):
        ignored = subprocess.run(
            ["git", "check-ignore", "build/ha-app/ringlife/ringlife-backend.jar"], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(ignored.returncode, 0)

    def test_gitattributes_forces_lf_on_linux_files(self):
        text = (ROOT / ".gitattributes").read_text(encoding="utf-8")
        for rule in ("*.sh text eol=lf", "Dockerfile text eol=lf", "*.yaml text eol=lf", ".githooks/* text eol=lf"):
            self.assertIn(rule, text)

    def test_the_package_script_writes_lf_copies_of_crlf_sources(self):
        import shutil
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "scripts").mkdir()
            shutil.copy(ROOT / "scripts" / "package-ha-app.sh", root / "scripts")
            app = root / "ha-app" / "ringlife"
            app.mkdir(parents=True)
            for name in ("config.yaml", "Dockerfile", "run.sh", "DOCS.md"):
                data = (APP / name).read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
                (app / name).write_bytes(data)
            for name in ("icon.png", "logo.png"):
                shutil.copy(APP / name, app / name)
            shutil.copy(ROOT / "CHANGELOG.md", root / "CHANGELOG.md")
            target = root / "backend" / "target"
            target.mkdir(parents=True)
            (target / "ringlife-backend-0.1.0.jar").write_bytes(b"jar")
            licenses = target / "generated-sources" / "license"
            licenses.mkdir(parents=True)
            (licenses / "THIRD-PARTY.txt").write_text("Lists of 1 third-party dependencies.\n     (MIT) Synthetic\n")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            mvn = bin_dir / "mvn"
            mvn.write_text("#!/bin/sh\nexit 0\n")
            mvn.chmod(0o755)
            out = root / "out"
            env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}")
            result = subprocess.run(
                ["sh", str(root / "scripts" / "package-ha-app.sh"), str(out)], capture_output=True, text=True, env=env
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in ("config.yaml", "Dockerfile", "run.sh"):
                self.assertNotIn(b"\r", (out / name).read_bytes(), name)
            # The local package is built on the server: no published image.
            packaged = yaml.safe_load((out / "config.yaml").read_text(encoding="utf-8"))
            self.assertNotIn("image", packaged)
            self.assertEqual(packaged["slug"], "ringlife")
            self.assertEqual((out / "run.sh").read_bytes().split(b"\n")[0], b"#!/usr/bin/with-contenv bashio")
            self.assertTrue(os.access(out / "run.sh", os.X_OK))
            self.assertTrue((out / "ringlife-backend.jar").is_file())
            # Licenze di terze parti accanto al jar e nell'immagine (docs/adr/0038).
            notices = (out / "THIRD-PARTY-LICENSES.txt").read_text(encoding="utf-8")
            self.assertIn("Eclipse Temurin JRE", notices)
            self.assertIn("(MIT) Synthetic", notices)
            # Home Assistant mostra le novita' della versione quando c'e' un aggiornamento (docs/adr/0037).
            self.assertEqual((out / "CHANGELOG.md").read_text(encoding="utf-8"), (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()


class AppImagesTest(unittest.TestCase):
    def test_icon_and_logo_exist_and_are_png(self):
        for name in ("icon.png", "logo.png"):
            self.assertEqual((APP / name).read_bytes()[:8], b"\x89PNG\r\n\x1a\n", name)
