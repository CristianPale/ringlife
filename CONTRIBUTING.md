# Contributing to RingLife

RingLife is a small personal project made public. Issues and pull requests are welcome; answers may take a while.

## Before you start

- Open an issue first for anything bigger than a fix, so we agree on the approach.
- **Never include real health data**: no exported databases, no screenshots with your values, no Bluetooth captures of your ring, no MAC addresses, tokens or home network details. Test fixtures are synthetic or anonymized (shifted dates, perturbed values, identifiers removed).
- RingLife is not a medical device. Do not add features that diagnose, or that suggest drugs or doses.
- No cloud service may receive health data.

## Development

Server (`backend/`, Java 25, Maven):

```bash
cd backend
mvn test
mvn spring-boot:run        # local server, database in ./data/ringlife.sqlite
```

App (`mobile/`, Node 22 or newer):

```bash
cd mobile
npm ci
npm start                  # dev server in the browser (no Bluetooth there)
npx ng test --watch=false
```

Scripts and protocol tools:

```bash
python3 -m unittest scripts/test_ha_app.py scripts/test_update_ha_app.py scripts/test_release.py
python3 -m unittest tools/test_tools.py
```

Testing anything that talks to the ring needs a physical phone: the iOS simulator has no Bluetooth.

## Conventions

- Identifiers and commit messages in English; the app interface in Italian. Most code comments are in Italian: new comments may be in Italian or English. Comments cite design decision records (`docs/adr/NNNN`) that live in the maintainers' notes and are not published.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- Every change a user can see adds one line to `CHANGELOG.md` under «Non rilasciata» («Novità» for features, «Correzioni» for fixes), in Italian. Never write a version number by hand: the release process sets it.
- A change to an index formula needs a new `algo_version` and a recompute, never a silent change. See [docs/scores.md](docs/scores.md).
- Protocol parsers come with tests built from anonymized captures.
- Do not copy code from projects whose license is incompatible with Apache-2.0 (for example AGPL code such as Gadgetbridge); reimplement from observed behavior.

## Secret scanning

The repository uses [gitleaks](https://github.com/gitleaks/gitleaks) with project rules in `.gitleaks.toml` (MAC addresses, Tailscale host names, private IPv4 addresses). Install it and enable the hook once per clone:

```bash
sh scripts/setup-hooks.sh
```

## License

By contributing you agree that your contribution is licensed under the Apache License 2.0.
