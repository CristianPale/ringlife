"""Test di scripts/release.py: versione successiva, chiusura del changelog, note e versione nei file.

python3 -m unittest scripts/test_release.py
"""

import datetime
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DAY = datetime.date(2026, 11, 23)


def changelog(unreleased: str, released: str = "## 0.1.0\n\nPrime prove.\n") -> str:
    return f"# Novità di RingLife\n\nTesta.\n\n## Non rilasciata\n\n{unreleased}\n{released}"


NEW_AND_FIX = "### Novità\n\n- Battito di oggi.\n\n### Correzioni\n\n- Notte intera.\n"
ONLY_FIX = "### Novità\n\n### Correzioni\n\n- Notte intera.\n"
EMPTY = "### Novità\n\n### Correzioni\n"


class NextVersionTest(unittest.TestCase):
    def test_a_new_feature_raises_the_minor(self):
        self.assertEqual(release.next_version(changelog(NEW_AND_FIX)), "0.2.0")

    def test_only_fixes_raise_the_patch(self):
        text = changelog(ONLY_FIX, "## 0.2.0 — 23 novembre 2026\n\n- x\n\n## 0.1.0\n")
        self.assertEqual(release.next_version(text), "0.2.1")

    def test_an_entry_outside_the_subsections_counts_as_new(self):
        self.assertEqual(release.next_version(changelog("- Qualcosa.\n")), "0.2.0")

    def test_without_a_released_version_it_starts_after_0_1_0(self):
        text = "# Novità\n\n## Non rilasciata\n\n### Correzioni\n\n- x\n"
        self.assertEqual(release.next_version(text), "0.1.1")

    def test_nothing_to_release_is_an_error(self):
        with self.assertRaisesRegex(release.ReleaseError, "non c'è niente da rilasciare"):
            release.next_version(changelog(EMPTY))

    def test_the_version_can_be_chosen_but_must_be_higher(self):
        self.assertEqual(release.next_version(changelog(ONLY_FIX), "1.0.0"), "1.0.0")
        with self.assertRaisesRegex(release.ReleaseError, "non è più alta"):
            release.next_version(changelog(ONLY_FIX), "0.1.0")
        with self.assertRaisesRegex(release.ReleaseError, "non valida"):
            release.next_version(changelog(ONLY_FIX), "1.0")


class CutTest(unittest.TestCase):
    def test_closes_the_unreleased_section_with_version_and_date_and_opens_an_empty_one(self):
        text = release.cut(changelog(ONLY_FIX), "0.1.1", DAY)
        self.assertIn("## Non rilasciata\n\n### Novità\n\n### Correzioni\n\n## 0.1.1 — 23 novembre 2026\n", text)
        # La sottosezione vuota non resta nella versione rilasciata.
        released = release.notes(text, "0.1.1")
        self.assertEqual(released, "### Correzioni\n\n- Notte intera.\n")
        self.assertEqual(release.current(text), (0, 1, 1))
        self.assertIn("## 0.1.0\n\nPrime prove.\n", text)
        with self.assertRaises(release.ReleaseError):
            release.next_version(text)

    def test_notes_of_a_missing_version_are_an_error(self):
        with self.assertRaisesRegex(release.ReleaseError, "non ha la versione 9.9.9"):
            release.notes(changelog(NEW_AND_FIX), "9.9.9")


class NotesTest(unittest.TestCase):
    def test_plain_notes_have_no_markdown(self):
        text = release.plain("### Novità\n\n- Il **battito** di `oggi`.\n")
        self.assertEqual(text, "Novità:\n\n• Il battito di oggi.\n")

    def test_a_test_build_shows_what_is_not_released_yet(self):
        text = release.cut(changelog(ONLY_FIX), "0.1.1", DAY).replace(
            "## Non rilasciata\n\n### Novità\n", "## Non rilasciata\n\n### Novità\n\n- Prova.\n"
        )
        notes = release.build_notes(text, "0.1.1")
        self.assertTrue(notes.startswith("Build di prova sulla 0.1.1"))
        self.assertIn("- Prova.", notes)
        self.assertNotIn("Notte intera", notes)

    def test_a_release_build_shows_the_notes_of_its_version(self):
        text = release.cut(changelog(ONLY_FIX), "0.1.1", DAY)
        self.assertEqual(release.build_notes(text, "0.1.1"), "### Correzioni\n\n- Notte intera.\n")


class SetVersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for path, _, _ in release.VERSION_FILES:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / path, target)
        shutil.copy(ROOT / "CHANGELOG.md", self.root / "CHANGELOG.md")

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, path):
        return (self.root / path).read_text(encoding="utf-8")

    def test_writes_the_version_in_the_app_and_the_server(self):
        before = self.read("mobile/package-lock.json")
        release.set_version(self.root, "97.98.99")
        self.assertIn('  "version": "97.98.99",', self.read("mobile/package.json"))
        lock = self.read("mobile/package-lock.json")
        # Solo il progetto, mai le dipendenze: due righe cambiate in tutto il lockfile.
        self.assertEqual(lock.count('"version": "97.98.99"'), 2)
        changed = [a for a, b in zip(before.splitlines(), lock.splitlines()) if a != b]
        self.assertEqual(len(changed), 2)
        self.assertIn("export const APP_VERSION = '97.98.99';", self.read("mobile/src/app/settings/settings.page.ts"))
        pbx = self.read("mobile/ios/App/App.xcodeproj/project.pbxproj")
        # App and notification extension, Debug and Release: the extension must carry the app version.
        self.assertEqual(pbx.count("MARKETING_VERSION = 97.98.99;"), 4)
        self.assertNotIn("MARKETING_VERSION = 0.", pbx)
        self.assertIn('versionName "97.98.99"', self.read("mobile/android/app/build.gradle"))
        self.assertIn("versionCode 97098099", self.read("mobile/android/app/build.gradle"))
        self.assertIn('version: "97.98.99"', self.read("ha-app/ringlife/config.yaml"))

    def test_the_android_version_code_grows_with_the_version(self):
        self.assertEqual(release.version_code("1.0.0"), 1_000_000)
        self.assertLess(release.version_code("1.0.9"), release.version_code("1.1.0"))
        self.assertLess(release.version_code("1.99.0"), release.version_code("2.0.0"))
        with self.assertRaises(release.ReleaseError):
            release.version_code("1.1000.0")

    def test_prepare_from_the_command_line_cuts_and_sets_everything(self):
        (self.root / "CHANGELOG.md").write_text(changelog(NEW_AND_FIX), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "release.py"), "--root", str(self.root), "prepare", "--date", "2026-11-23"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        version = result.stdout.strip()
        self.assertEqual(version, "0.2.0")
        self.assertIn(f"## {version} — 23 novembre 2026", self.read("CHANGELOG.md"))
        self.assertIn(f'version: "{version}"', self.read("ha-app/ringlife/config.yaml"))

    def test_an_empty_changelog_stops_the_release_with_a_clear_message(self):
        (self.root / "CHANGELOG.md").write_text(changelog(EMPTY), encoding="utf-8")
        config = self.read("ha-app/ringlife/config.yaml")
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "release.py"), "--root", str(self.root), "prepare"],
            capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non c'è niente da rilasciare", result.stderr)
        self.assertEqual(self.read("ha-app/ringlife/config.yaml"), config)


class RepositoryChangelogTest(unittest.TestCase):
    def test_the_changelog_of_the_repository_is_readable(self):
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        release.unreleased(text)
        self.assertIsNotNone(release.current(text))


if __name__ == "__main__":
    unittest.main()
