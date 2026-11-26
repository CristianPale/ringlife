"""Dice quale formula di checksum combacia con i pacchetti catturati dall'anello.

Le due candidate (docs/protocol.md): `mod255` (somma dei primi 15 byte modulo 255) e `mod256` (byte basso della somma).
Uso: python3 checksum_check.py ../local-data/captures/*.json
Esito: per ogni formula, quanti pacchetti da 16 byte tornano. Una formula che li fa tornare TUTTI, con almeno un
pacchetto la cui somma raggiunge 255 (dove le due divergono), è quella giusta. Altrimenti il programma lo dice.
"""
import glob
import sys
from pathlib import Path

import capture_format


def checksum(body: bytes, kind: str) -> int:
    total = sum(body)
    return total % 255 if kind == "mod255" else total & 255


def analyse(frames: list[bytes]) -> dict:
    fit = {"mod255": 0, "mod256": 0}
    discriminating = 0
    for frame in frames:
        body, last = frame[:15], frame[15]
        ok255 = checksum(body, "mod255") == last
        ok256 = checksum(body, "mod256") == last
        fit["mod255"] += ok255
        fit["mod256"] += ok256
        if sum(body) >= 255:
            discriminating += 1
    return {"frames": len(frames), "fit": fit, "discriminating": discriminating}


def verdict(result: dict) -> str:
    total, fit, discriminating = result["frames"], result["fit"], result["discriminating"]
    if total == 0:
        return "Nessun pacchetto da 16 byte nelle catture."
    both = fit["mod255"] == total and fit["mod256"] == total
    if both:
        return (
            f"Le due formule tornano su tutti i {total} pacchetti: non si distinguono. "
            "Servono pacchetti la cui somma arriva a 255 o più."
            if discriminating == 0
            else "Le due formule tornano su tutti i pacchetti, anche su quelli che le distinguono: controllare le catture."
        )
    for kind in ("mod255", "mod256"):
        if fit[kind] == total:
            note = "" if discriminating else " (ma nessun pacchetto la distingue dall'altra: servono più pacchetti)"
            return f"Tutti i {total} pacchetti tornano con {kind}{note}."
    return "Nessuna delle due formule torna su tutti i pacchetti: i pacchetti non sono tutti da 16 byte con checksum, o la formula è un'altra."


def expand(patterns: list[str]) -> list[str]:
    """Espande i caratteri jolly (`*.json`): PowerShell non lo fa per i programmi, la shell di Linux sì."""
    names: list[str] = []
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        names.extend(matches if matches else [pattern])
    return names


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    frames: list[bytes] = []
    for name in expand(argv):
        frames.extend(capture_format.frames(capture_format.load(Path(name))))
    result = analyse(frames)
    print(f"Pacchetti da 16 byte: {result['frames']} (di cui con somma >= 255: {result['discriminating']})")
    print(f"mod255: {result['fit']['mod255']}   mod256: {result['fit']['mod256']}")
    print(verdict(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
