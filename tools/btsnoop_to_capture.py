"""Converte un registro HCI di Android (btsnoop_hci.log) nel formato delle catture, tenendo solo le scritture e le
notifiche GATT (ATT) dell'app che parla con l'anello.

Uso: python3 btsnoop_to_capture.py registro.log --out produttore-batteria [--handle 0x0012] [--note "..."]

Il registro contiene il traffico di TUTTI i dispositivi Bluetooth del telefono: senza `--handle` si tengono tutte le
scritture e notifiche, e conviene catturare con un solo dispositivo collegato. L'indirizzo non finisce nella cattura
(il registro lo contiene, e per questo il registro stesso resta solo in `local-data/`). Non provato su registri veri.
"""
import argparse
import struct
import sys
from pathlib import Path

import capture_format

BTSNOOP_MAGIC = b"btsnoop\x00"
DATALINK_H4 = 1002
HCI_ACL = 0x02
CID_ATT = 0x0004
ATT_WRITE_REQUEST = 0x12
ATT_WRITE_COMMAND = 0x52
ATT_NOTIFICATION = 0x1B
ATT_READ_RESPONSE = 0x0B
# btsnoop conta i microsecondi dal primo gennaio dell'anno 0: si usano solo le differenze.


def read_records(data: bytes):
    """(flags, microsecondi, pacchetto H4) per ogni record del registro."""
    if data[:8] != BTSNOOP_MAGIC:
        raise ValueError("Non è un registro btsnoop")
    _version, datalink = struct.unpack(">II", data[8:16])
    if datalink != DATALINK_H4:
        raise ValueError(f"Tipo di collegamento {datalink} non supportato (serve H4, {DATALINK_H4})")
    offset = 16
    while offset + 24 <= len(data):
        _orig, included, flags, _drops, timestamp = struct.unpack(">IIIIq", data[offset : offset + 24])
        offset += 24
        yield flags, timestamp, data[offset : offset + included]
        offset += included


def att_events(data: bytes, only_handle: int | None = None):
    """(microsecondi, direzione, handle, valore) per ogni scrittura o notifica ATT."""
    for flags, timestamp, packet in read_records(data):
        if not packet or packet[0] != HCI_ACL or len(packet) < 9:
            continue
        # Intestazione ACL: handle di connessione e flag, lunghezza. Poi L2CAP: lunghezza e canale.
        _l2cap_length, cid = struct.unpack("<HH", packet[5:9])
        if cid != CID_ATT or len(packet) < 10:
            continue
        att = packet[9:]
        opcode = att[0]
        sent = (flags & 1) == 0
        if opcode in (ATT_WRITE_REQUEST, ATT_WRITE_COMMAND) and sent and len(att) >= 3:
            handle, value = struct.unpack("<H", att[1:3])[0], att[3:]
            direction = "tx"
        elif opcode == ATT_NOTIFICATION and not sent and len(att) >= 3:
            handle, value = struct.unpack("<H", att[1:3])[0], att[3:]
            direction = "rx"
        else:
            continue
        if only_handle is None or handle == only_handle:
            yield timestamp, direction, handle, value


def convert(data: bytes, note: str = "", only_handle: int | None = None) -> dict:
    capture = capture_format.new_capture(note)
    first = None
    for timestamp, direction, _handle, value in att_events(data, only_handle):
        first = timestamp if first is None else first
        capture_format.add_packet(capture, (timestamp - first) // 1000, direction, value)
    return capture


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("log", type=Path)
    p.add_argument("--out", required=True)
    p.add_argument("--handle", type=lambda s: int(s, 0))
    p.add_argument("--note", default="")
    args = p.parse_args(argv)
    capture = convert(args.log.read_bytes(), args.note, args.handle)
    path = Path(__file__).resolve().parent.parent / "local-data" / "captures" / f"{args.out}.json"
    capture_format.save(capture, path)
    print(f"Salvati {len(capture['packets'])} pacchetti in local-data/captures/{path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
