#!/usr/bin/env python3
"""Apply manual distribution signing to the Release config of the iOS app targets.

Usage: apply-ios-signing.py <project.pbxproj> <team-id> <bundle-id>=<profile-name> [<bundle-id>=<profile-name> ...]

Used by CI only. Signing settings must live on the app targets alone: passed on
the xcodebuild command line they would also hit the SPM resource bundles, which
do not support provisioning profiles. Each target is found by its
PRODUCT_BUNDLE_IDENTIFIER (the App and the notification extension). The
committed project keeps Automatic signing so that opening it in Xcode still
works. Idempotent.
"""
import re
import sys

BLOCK = re.compile(
    r"(isa = XCBuildConfiguration;\n\t\t\tbuildSettings = \{\n)"
    r"((?:(?!\n\t\t\t\};).)*?\n)"
    r"(\t\t\t\};\n\t\t\tname = Release;)",
    re.DOTALL,
)


def apply(text: str, team: str, profiles: dict) -> str:
    done = set()

    def sign(match: "re.Match") -> str:
        settings = match.group(2)
        found = re.search(r"\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ([^;\n]+);\n", settings)
        if not found or found.group(1).strip() not in profiles:
            return match.group(0)
        bundle = found.group(1).strip()
        done.add(bundle)
        settings = re.sub(
            r"\t\t\t\t(CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER) = [^\n]*;\n",
            "",
            settings,
        )
        settings = re.sub(r"\t\t\t\t\"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]\" = [^\n]*;\n", "", settings)
        signing = (
            "\t\t\t\tCODE_SIGN_STYLE = Manual;\n"
            '\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";\n'
            f"\t\t\t\tDEVELOPMENT_TEAM = {team};\n"
            f'\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{profiles[bundle]}";\n'
        )
        return match.group(1) + signing + settings + match.group(3)

    out = BLOCK.sub(sign, text)
    missing = set(profiles) - done
    if missing:
        raise SystemExit("Release configuration not found for: " + ", ".join(sorted(missing)))
    return out


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    path, team, *pairs = sys.argv[1:]
    profiles = {}
    for pair in pairs:
        bundle, sep, profile = pair.partition("=")
        if not sep or not bundle or not profile:
            raise SystemExit("Expected <bundle-id>=<profile-name>, got: " + pair)
        profiles[bundle] = profile
    for value in [team, *profiles.keys(), *profiles.values()]:
        if '"' in value or "\n" in value or "\\" in value:
            raise SystemExit("Invalid character in profile name, bundle id or team id")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(apply(text, team, profiles))


if __name__ == "__main__":
    main()
