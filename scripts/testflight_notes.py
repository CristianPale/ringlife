#!/usr/bin/env python3
"""Scrive le note di una build in «Cosa testare» di TestFlight (docs/adr/0037-versione-unica-e-changelog.md).

Gira su GitHub Actions dopo l'upload, su Linux (i minuti macOS costano dieci volte tanto). Usa l'API di App Store
Connect con la stessa chiave dell'upload: aspetta che la build compaia, poi aggiorna le note di ogni lingua della
build, o crea quella italiana se non ce n'è nessuna.

Uso:
  testflight_notes.py --bundle-id com.example.app --version 0.2.0 --build 263271034 --notes-file note.txt
Variabili: ASC_API_KEY_ID, ASC_API_ISSUER_ID, ASC_API_KEY_P8 (il file .p8 in base64, come per l'upload),
ASC_API (base dell'API, solo per i test), TESTFLIGHT_WAIT_SECONDS (predefinito 1200), TESTFLIGHT_POLL_SECONDS (30).
Richiede il pacchetto `cryptography`.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

# TestFlight accetta al massimo 4000 caratteri in «Cosa testare».
MAX_NOTES = 4000
# Nell'API il campo di «Cosa testare» si chiama `whatsNew` (un `whatToTest` dà HTTP 409, attributo sconosciuto).
LOCALE = "it"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def token(key_id: str, issuer_id: str, private_key_pem: bytes, now: int | None = None) -> str:
    """JWT ES256 per l'API di App Store Connect, valido 15 minuti (il massimo è 20)."""
    issued = int(time.time()) if now is None else now
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {"iss": issuer_id, "iat": issued, "exp": issued + 15 * 60, "aud": "appstoreconnect-v1"}
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}".encode("ascii")
    key = serialization.load_pem_private_key(private_key_pem, password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise SystemExit("La chiave ASC_API_KEY_P8 non è una chiave EC.")
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"{signing_input.decode('ascii')}.{b64url(signature)}"


class Api:
    def __init__(self, base: str, key_id: str, issuer_id: str, private_key_pem: bytes):
        self.base = base.rstrip("/")
        self.key_id = key_id
        self.issuer_id = issuer_id
        self.private_key_pem = private_key_pem

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        request = urllib.request.Request(
            f"{self.base}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token(self.key_id, self.issuer_id, self.private_key_pem)}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            # Stato, titolo, dettaglio e campo dell'errore: la risposta non contiene segreti e dice cosa correggere.
            detail = ""
            try:
                errors = json.loads(error.read()).get("errors", [])
                parts = []
                for e in errors:
                    pointer = (e.get("source") or {}).get("pointer", "")
                    parts.append(" ".join(x for x in (e.get("title", ""), e.get("detail", ""), f"({pointer})" if pointer else "") if x))
                detail = "; ".join(parts)
            except (ValueError, AttributeError):
                pass
            raise RuntimeError(f"{method} {path.split('?')[0]}: HTTP {error.code} {detail}".strip()) from None
        return json.loads(raw) if raw else {}


def app_id(api: Api, bundle_id: str) -> str:
    data = api.call("GET", "/v1/apps?" + urllib.parse.urlencode({"filter[bundleId]": bundle_id}))["data"]
    if not data:
        raise RuntimeError(f"Nessuna app con bundle id {bundle_id} su App Store Connect.")
    return data[0]["id"]


def wait_for_build(api: Api, app: str, version: str, build: str, wait: int, poll: int) -> str:
    """L'id della build su App Store Connect. Compare qualche minuto dopo l'upload: si riprova fino a `wait` secondi."""
    query = urllib.parse.urlencode(
        {"filter[app]": app, "filter[version]": build, "filter[preReleaseVersion.version]": version, "limit": "1"}
    )
    deadline = time.monotonic() + wait
    while True:
        data = api.call("GET", f"/v1/builds?{query}")["data"]
        if data:
            return data[0]["id"]
        if time.monotonic() >= deadline:
            raise RuntimeError(f"La build {version} ({build}) non è comparsa su App Store Connect entro {wait} secondi.")
        print(f"Aspetto che la build {version} ({build}) compaia su App Store Connect...", flush=True)
        time.sleep(poll)


def write_notes(api: Api, build_id: str, notes: str) -> list[str]:
    """Aggiorna «Cosa testare» di ogni lingua della build; senza lingue crea quella italiana. Restituisce le lingue."""
    text = notes.strip()[:MAX_NOTES]
    localizations = api.call("GET", f"/v1/builds/{build_id}/betaBuildLocalizations")["data"]
    if not localizations:
        api.call(
            "POST",
            "/v1/betaBuildLocalizations",
            {
                "data": {
                    "type": "betaBuildLocalizations",
                    "attributes": {"locale": LOCALE, "whatsNew": text},
                    "relationships": {"build": {"data": {"type": "builds", "id": build_id}}},
                }
            },
        )
        return [LOCALE]
    locales = []
    for item in localizations:
        api.call(
            "PATCH",
            f"/v1/betaBuildLocalizations/{item['id']}",
            {"data": {"type": "betaBuildLocalizations", "id": item["id"], "attributes": {"whatsNew": text}}},
        )
        locales.append(item.get("attributes", {}).get("locale", "?"))
    return locales


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True)
    parser.add_argument("--notes-file", required=True)
    args = parser.parse_args(argv)

    missing = [name for name in ("ASC_API_KEY_ID", "ASC_API_ISSUER_ID", "ASC_API_KEY_P8") if not os.environ.get(name)]
    if missing:
        print(f"Mancano i segreti: {', '.join(missing)}.", file=sys.stderr)
        return 1
    api = Api(
        os.environ.get("ASC_API", "https://api.appstoreconnect.apple.com"),
        os.environ["ASC_API_KEY_ID"],
        os.environ["ASC_API_ISSUER_ID"],
        base64.b64decode(os.environ["ASC_API_KEY_P8"]),
    )
    with open(args.notes_file, encoding="utf-8") as file:
        notes = file.read()
    try:
        app = app_id(api, args.bundle_id)
        build_id = wait_for_build(
            api, app, args.version, args.build,
            int(os.environ.get("TESTFLIGHT_WAIT_SECONDS", "1200")), int(os.environ.get("TESTFLIGHT_POLL_SECONDS", "30")),
        )
        locales = write_notes(api, build_id, notes)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Note di TestFlight scritte per la build {args.version} ({args.build}): {', '.join(locales)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
