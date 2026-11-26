#!/usr/bin/env python3
"""Versione unica e changelog di RingLife (docs/adr/0037-versione-unica-e-changelog.md).

CHANGELOG.md, nella radice del repository, ha in cima la sezione «Non rilasciata» con le sottosezioni «Novità» e
«Correzioni»; sotto, una sezione per versione rilasciata: «## 0.2.0 — 23 novembre 2026».

Comandi:
  release.py next [--version X.Y.Z]           la versione da rilasciare, senza toccare niente
  release.py prepare [--version X.Y.Z] [--date AAAA-MM-GG]
                                              chiude «Non rilasciata» in una sezione con la versione e la data e scrive
                                              la versione nei file dell'app e del server; stampa la versione
  release.py notes VERSIONE [--plain]         le note di una versione (per la release GitHub); --plain senza markdown
  release.py build-notes VERSIONE             le note per una build di TestFlight: «Non rilasciata» se ha voci, se no
                                              quelle della versione
  release.py current                          l'ultima versione rilasciata

La versione successiva: minore se «Non rilasciata» ha novità, patch se ha solo correzioni. --version la sceglie a
mano (per esempio 1.0.0) e deve essere più alta dell'ultima.
"""

from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = "CHANGELOG.md"
UNRELEASED = "Non rilasciata"
NEW = "Novità"
FIXES = "Correzioni"
# Prima del changelog l'app e il server erano alla 0.1: la prima versione con le novità parte da qui.
BASE_VERSION = (0, 1, 0)
MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
RELEASED = re.compile(r"^## (\d+\.\d+\.\d+)\b")


class ReleaseError(Exception):
    """Un errore da dire così com'è a chi lancia il rilascio."""


def parse_version(text: str) -> tuple[int, int, int]:
    match = SEMVER.match(text.strip())
    if not match:
        raise ReleaseError(f"Versione «{text}» non valida: serve X.Y.Z, per esempio 1.0.0.")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def format_version(version: tuple[int, int, int]) -> str:
    return ".".join(str(part) for part in version)


def italian_date(day: datetime.date) -> str:
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


def sections(text: str) -> list[tuple[str, list[str]]]:
    """Le sezioni `## ...` del changelog con le loro righe, in ordine. La testa prima della prima sezione ha titolo ''."""
    out: list[tuple[str, list[str]]] = [("", [])]
    for line in text.splitlines():
        if line.startswith("## "):
            out.append((line[3:].strip(), []))
        else:
            out[-1][1].append(line)
    return out


def entries(lines: list[str]) -> list[str]:
    return [line for line in lines if line.startswith("- ")]


def unreleased(text: str) -> list[str]:
    for title, lines in sections(text):
        if title == UNRELEASED:
            return lines
    raise ReleaseError(f"CHANGELOG.md non ha la sezione «## {UNRELEASED}».")


def subsection(lines: list[str], name: str) -> list[str]:
    """Le righe della sottosezione `### name` dentro una sezione."""
    out: list[str] = []
    inside = False
    for line in lines:
        if line.startswith("### "):
            inside = line[4:].strip() == name
        elif inside:
            out.append(line)
    return out


def current(text: str) -> tuple[int, int, int] | None:
    """L'ultima versione rilasciata: la prima sezione con un numero."""
    for line in text.splitlines():
        match = RELEASED.match(line)
        if match:
            return parse_version(match.group(1))
    return None


def next_version(text: str, override: str = "") -> str:
    base = current(text) or BASE_VERSION
    pending = unreleased(text)
    if override:
        wanted = parse_version(override)
        if wanted <= base:
            raise ReleaseError(f"La versione {override} non è più alta dell'ultima, {format_version(base)}.")
        if not entries(pending):
            raise ReleaseError(f"«{UNRELEASED}» è vuota: scrivi le novità della {override} prima di rilasciarla.")
        return override
    if not entries(pending):
        raise ReleaseError(f"«{UNRELEASED}» in CHANGELOG.md è vuota: non c'è niente da rilasciare.")
    major, minor, patch = base
    # Solo correzioni: patch. Una novità, o una voce fuori dalle sottosezioni: minore.
    only_fixes = not entries(subsection(pending, NEW)) and len(entries(subsection(pending, FIXES))) == len(entries(pending))
    return format_version((major, minor, patch + 1) if only_fixes else (major, minor + 1, 0))


def cut(text: str, version: str, day: datetime.date) -> str:
    """Chiude «Non rilasciata» nella sezione della versione e ne apre una nuova, vuota, sopra."""
    out: list[str] = []
    for title, lines in sections(text):
        if title == "":
            out.extend(lines)
            continue
        if title != UNRELEASED:
            out.append(f"## {title}")
            out.extend(lines)
            continue
        out.extend([f"## {UNRELEASED}", "", f"### {NEW}", "", f"### {FIXES}", "", f"## {version} — {italian_date(day)}"])
        out.extend(drop_empty_subsections(lines))
    return "\n".join(out).rstrip("\n") + "\n"


def drop_empty_subsections(lines: list[str]) -> list[str]:
    """Toglie le sottosezioni `###` senza voci, così la versione rilasciata mostra solo quello che c'è."""
    out: list[str] = []
    pending_heading: list[str] = []
    has_entries = False
    for line in lines:
        if line.startswith("### "):
            if pending_heading and has_entries:
                out.extend(pending_heading)
            pending_heading = [line]
            has_entries = False
        elif pending_heading:
            pending_heading.append(line)
            has_entries = has_entries or line.startswith("- ")
        else:
            out.append(line)
    if pending_heading and has_entries:
        out.extend(pending_heading)
    while out and out[-1].strip() == "":
        out.pop()
    return out + [""]


def notes(text: str, version: str) -> str:
    for title, lines in sections(text):
        match = RELEASED.match(f"## {title}")
        if match and match.group(1) == version:
            return "\n".join(drop_empty_subsections(lines)).strip() + "\n"
    raise ReleaseError(f"CHANGELOG.md non ha la versione {version}.")


def build_notes(text: str, version: str) -> str:
    """Le note di una build: le modifiche non ancora rilasciate se ce ne sono (build di prova), se no la versione."""
    pending = unreleased(text)
    if entries(pending):
        body = "\n".join(drop_empty_subsections(pending)).strip()
        return f"Build di prova sulla {version}, con modifiche non ancora rilasciate.\n\n{body}\n"
    return notes(text, version)


def plain(markdown: str) -> str:
    """Testo semplice per TestFlight: i titoli `###` diventano «Novità:», niente asterischi o backtick."""
    out: list[str] = []
    for line in markdown.splitlines():
        if line.startswith("### "):
            line = f"{line[4:].strip()}:"
        elif line.startswith("- "):
            line = f"• {line[2:]}"
        out.append(line.replace("**", "").replace("`", ""))
    return "\n".join(out).strip() + "\n"


# Dove sta la versione, file per file: (percorso, espressione, quante volte deve comparire).
VERSION_FILES = [
    ("mobile/package.json", r'(?m)^(  "version": ")[^"]*(")', 1),
    ("mobile/package-lock.json", r'(?m)^(  "version": ")[^"]*(")', 1),
    ("mobile/package-lock.json", r'("": \{\n\s+"name": "ringlife-mobile",\n\s+"version": ")[^"]*(")', 1),
    ("mobile/src/app/settings/settings.page.ts", r"(export const APP_VERSION = ')[^']*(')", 1),
    ("mobile/ios/App/App.xcodeproj/project.pbxproj", r"(MARKETING_VERSION = )[^;]*(;)", None),
    ("mobile/android/app/build.gradle", r'(versionName ")[^"]*(")', 1),
    ("ha-app/ringlife/config.yaml", r'(?m)^(version: ")[^"]*(")', 1),
]


def set_version(root: Path, version: str) -> None:
    """Scrive la versione nell'app (iOS, Android, Impostazioni) e nel server (app di Home Assistant)."""
    parse_version(version)
    for path, pattern, expected in VERSION_FILES:
        file = root / path
        text = file.read_text(encoding="utf-8")
        updated, count = re.subn(pattern, lambda m: f"{m.group(1)}{version}{m.group(2)}", text)
        if count == 0 or (expected is not None and count != expected):
            raise ReleaseError(f"Versione non trovata dove serve in {path}.")
        file.write_text(updated, encoding="utf-8")
    # Android vuole anche un numero intero che cresce a ogni versione (versionCode, docs/adr/0050).
    gradle = root / "mobile/android/app/build.gradle"
    text = gradle.read_text(encoding="utf-8")
    updated, count = re.subn(r"(versionCode )\d+", lambda m: f"{m.group(1)}{version_code(version)}", text)
    if count != 1:
        raise ReleaseError("versionCode non trovato in mobile/android/app/build.gradle.")
    gradle.write_text(updated, encoding="utf-8")


def version_code(version: str) -> int:
    """Il versionCode di Android: MAJOR * 1.000.000 + MINOR * 1.000 + PATCH, cresce con la versione."""
    major, minor, patch = parse_version(version)
    if minor > 999 or patch > 999:
        raise ReleaseError(f"Versione {version}: minore e patch devono stare sotto 1000 per Android.")
    return major * 1_000_000 + minor * 1_000 + patch


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=str(ROOT), help=argparse.SUPPRESS)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("next", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("--version", default="")
        if name == "prepare":
            command.add_argument("--date", default="")
    notes_command = commands.add_parser("notes")
    notes_command.add_argument("version")
    notes_command.add_argument("--plain", action="store_true")
    build_command = commands.add_parser("build-notes")
    build_command.add_argument("version")
    commands.add_parser("current")
    args = parser.parse_args(argv)

    root = Path(args.root)
    changelog = root / CHANGELOG
    text = changelog.read_text(encoding="utf-8")
    try:
        if args.command == "next":
            print(next_version(text, args.version))
        elif args.command == "prepare":
            version = next_version(text, args.version)
            day = datetime.date.fromisoformat(args.date) if args.date else datetime.date.today()
            changelog.write_text(cut(text, version, day), encoding="utf-8")
            set_version(root, version)
            print(version)
        elif args.command == "notes":
            body = notes(text, args.version)
            print(plain(body) if args.plain else body, end="")
        elif args.command == "build-notes":
            print(plain(build_notes(text, args.version)), end="")
        elif args.command == "current":
            print(format_version(current(text) or BASE_VERSION))
    except ReleaseError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
