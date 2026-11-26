"""Formato delle catture dei pacchetti dell'anello (docs/release/ANELLO-GIORNO-1.md).

Le catture vere stanno SOLO in `local-data/captures/` (ignorata da git). Una cattura non contiene l'indirizzo MAC né il
seriale dell'anello: `validate` li rifiuta, anche scritti nella nota. Per mettere una cattura nel repo come fixture
va prima anonimizzata (date traslate, valori perturbati) e rinominata.
"""
import json
import re
from pathlib import Path

FORMAT_VERSION = 1
FRAME_LENGTH = 16
# Sei coppie con lo stesso separatore: un orario come «16:19:47-16:20:16» mescola `:` e `-` e non è un MAC.
MAC_PATTERN = re.compile(r"[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}")
HEX_PATTERN = re.compile(r"^[0-9a-f]*$")


def new_capture(note: str = "", firmware: str | None = None, started: str | None = None) -> dict:
    return {"format": FORMAT_VERSION, "ring": "R09", "firmware": firmware, "note": note, "started": started, "packets": []}


def add_packet(capture: dict, t_ms: int, direction: str, data: bytes) -> None:
    capture["packets"].append({"t": int(t_ms), "dir": direction, "hex": data.hex()})


def validate(capture: dict) -> list[str]:
    """Elenco dei problemi di una cattura. Vuoto = valida."""
    problems: list[str] = []
    if capture.get("format") != FORMAT_VERSION:
        problems.append(f"formato non supportato: {capture.get('format')!r}")
    for field in ("note", "firmware"):
        value = capture.get(field)
        if isinstance(value, str) and MAC_PATTERN.search(value):
            problems.append(f"{field}: contiene un indirizzo MAC")
    packets = capture.get("packets")
    if not isinstance(packets, list):
        return problems + ["packets: manca l'elenco"]
    last_t = -1
    for index, packet in enumerate(packets):
        where = f"pacchetto {index}"
        if packet.get("dir") not in ("tx", "rx"):
            problems.append(f"{where}: dir deve essere tx o rx")
        text = packet.get("hex")
        if not isinstance(text, str) or not HEX_PATTERN.match(text) or len(text) % 2:
            problems.append(f"{where}: hex non valido")
        elif MAC_PATTERN.search(text):
            problems.append(f"{where}: sembra un indirizzo MAC")
        t = packet.get("t")
        if not isinstance(t, int) or t < last_t:
            problems.append(f"{where}: il tempo deve essere un intero che non torna indietro")
        else:
            last_t = t
    return problems


def save(capture: dict, path: Path) -> None:
    problems = validate(capture)
    if problems:
        raise ValueError("; ".join(problems))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(capture, indent=2) + "\n", encoding="utf-8")


def load(path: Path) -> dict:
    capture = json.loads(path.read_text(encoding="utf-8"))
    problems = validate(capture)
    if problems:
        raise ValueError(f"{path.name}: " + "; ".join(problems))
    return capture


def frames(capture: dict, direction: str | None = None) -> list[bytes]:
    """I pacchetti da 16 byte (quelli per cui ha senso il checksum), nell'ordine in cui sono stati visti."""
    out = []
    for packet in capture["packets"]:
        data = bytes.fromhex(packet["hex"])
        if len(data) == FRAME_LENGTH and (direction is None or packet["dir"] == direction):
            out.append(data)
    return out
