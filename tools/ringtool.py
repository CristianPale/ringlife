"""Strumento per il giorno dell'anello: cerca l'anello, ne elenca i servizi e salva i pacchetti scambiati.

NON PROVATO senza l'anello: la parte Bluetooth (bleak) si verifica il primo giorno. La parte sul formato delle catture
è testata (test_tools.py). Le catture vanno in `local-data/captures/`, mai nel repo.

    python3 ringtool.py scan [--name-prefix R09]
    python3 ringtool.py services --name-prefix R09
    python3 ringtool.py capture --name-prefix R09 --write-uuid <uuid> --notify-uuid <uuid> \
        --send 0300 --send 4300 --checksum mod256 --wait 10 --out batteria --note "batteria al 60%"
    python3 ringtool.py watch --hours 24 --battery-every 30 --out continuo --note "collegamento continuo"
    python3 ringtool.py watch --hours 24 --poll-every 30 --out a-intervalli --note "solo batteria ogni 30 min"
    python3 ringtool.py watch-summary local-data/captures/<file>.json

`watch` (docs/release/PROVA-COLLEGAMENTO-CONTINUO.md) resta collegato all'anello e registra tutto quello che l'anello
manda da solo, con la batteria ogni `--battery-every` minuti; si ricollega se il collegamento cade. Con `--poll-every`
invece si collega ogni N minuti, legge la batteria e si scollega: è il confronto senza collegamento continuo. Salva la
cattura ogni 10 minuti e all'interruzione (Ctrl+C). `watch-summary` ne fa il riassunto ora per ora.

`--send` prende i byte del comando (e dei dati) in esadecimale, senza il checksum, che si aggiunge con `--checksum`
(`mod255` o `mod256`); con `--checksum none` si manda esattamente quello che si scrive (16 byte). L'indirizzo
dell'anello non si salva mai nella cattura.
"""
import argparse
import asyncio
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import capture_format

CAPTURES = Path(__file__).resolve().parent.parent / "local-data" / "captures"

# I canali dell'anello, come nell'app (mobile/src/app/ring/ble/capacitor-ring-link.ts).
COMMAND_WRITE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
COMMAND_NOTIFY = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
BIG_NOTIFY = "de5bf729-d711-4e47-af26-65e3012a5dc7"
# Il checksum verificato (docs/protocol.md) e il nome con cui l'anello si annuncia.
CHECKSUM = "mod256"
RING_NAME_PREFIX = "COLMI"
SAVE_EVERY_S = 600


def build_packet(hex_text: str, checksum: str) -> bytes:
    body = bytes.fromhex(hex_text.replace(" ", ""))
    if checksum == "none":
        return body
    if len(body) > 15:
        raise ValueError("Comando e dati sono al massimo 15 byte, il checksum è il sedicesimo")
    body = body.ljust(15, b"\x00")
    total = sum(body)
    return body + bytes([total % 255 if checksum == "mod255" else total & 255])


async def find(name_prefix: str, timeout: float):
    from bleak import BleakScanner  # solo qui: i test non richiedono Bluetooth

    devices = await BleakScanner.discover(timeout=timeout)
    return [d for d in devices if (d.name or "").startswith(name_prefix)]


async def cmd_scan(args) -> int:
    from bleak import BleakScanner

    for device in await BleakScanner.discover(timeout=args.timeout):
        if device.name and device.name.startswith(args.name_prefix):
            print(f"{device.name}")
    print("(l'indirizzo non si stampa: non deve finire in appunti o catture)")
    return 0


async def cmd_services(args) -> int:
    from bleak import BleakClient

    found = await find(args.name_prefix, args.timeout)
    if not found:
        print("Anello non trovato.")
        return 1
    async with BleakClient(found[0]) as client:
        for service in client.services:
            print(f"servizio {service.uuid}")
            for characteristic in service.characteristics:
                print(f"  {characteristic.uuid}  {','.join(characteristic.properties)}")
    return 0


async def cmd_capture(args) -> int:
    from bleak import BleakClient

    found = await find(args.name_prefix, args.timeout)
    if not found:
        print("Anello non trovato.")
        return 1
    capture = capture_format.new_capture(args.note, started=datetime.now(timezone.utc).isoformat())
    began = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - began) * 1000)

    def on_notify(_, data: bytearray) -> None:
        capture_format.add_packet(capture, elapsed(), "rx", bytes(data))

    async with BleakClient(found[0]) as client:
        await client.start_notify(args.notify_uuid, on_notify)
        for text in args.send:
            packet = build_packet(text, args.checksum)
            capture_format.add_packet(capture, elapsed(), "tx", packet)
            await client.write_gatt_char(args.write_uuid, packet, response=False)
            await asyncio.sleep(args.gap)
        await asyncio.sleep(args.wait)
        await client.stop_notify(args.notify_uuid)

    path = CAPTURES / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{args.out}.json"
    capture_format.save(capture, path)
    print(f"Salvati {len(capture['packets'])} pacchetti in {path.relative_to(CAPTURES.parent.parent)}")
    return 0


def watch_key(data: bytes) -> str:
    """Il tipo di un pacchetto ricevuto: il comando, e per gli eventi spontanei `73` anche il sottotipo."""
    if not data:
        return "vuoto"
    if data[0] == 0x73 and len(data) > 1:
        return f"73 {data[1]:02x}"
    return f"{data[0]:02x}"


def watch_summary(capture: dict) -> list[str]:
    """Righe del riassunto: pacchetti ricevuti per ora e per tipo, batteria nel tempo, eventi del collegamento."""
    hours: dict[int, Counter] = defaultdict(Counter)
    battery: list[tuple[int, int, bool]] = []
    for packet in capture["packets"]:
        if packet["dir"] != "rx":
            continue
        data = bytes.fromhex(packet["hex"])
        hours[packet["t"] // 3_600_000][watch_key(data)] += 1
        if len(data) >= 3 and data[0] == 0x03:
            battery.append((packet["t"], min(100, data[1]), data[2] == 1))
    lines = ["Pacchetti ricevuti, ora per ora dall'inizio:"]
    for hour in sorted(hours):
        kinds = ", ".join(f"{kind} ×{count}" for kind, count in sorted(hours[hour].items()))
        lines.append(f"  ora {hour:>3}: {kinds}")
    if not hours:
        lines.append("  nessuno")
    if battery:
        lines.append("Batteria:")
        lines.extend(f"  {t / 3_600_000:6.1f} h  {percent:3d}%{' in carica' if charging else ''}" for t, percent, charging in battery)
        unplugged = [(t, percent) for t, percent, charging in battery if not charging]
        if len(unplugged) >= 2 and unplugged[-1][0] > unplugged[0][0]:
            span = (unplugged[-1][0] - unplugged[0][0]) / 3_600_000
            drop = unplugged[0][1] - unplugged[-1][1]
            lines.append(f"  calo fuori carica: {drop} punti in {span:.1f} h, {drop / span:.2f} punti all'ora")
    links = Counter(link["event"] for link in capture.get("links", []))
    if links:
        lines.append("Collegamento: " + ", ".join(f"{event} ×{count}" for event, count in sorted(links.items())))
    return lines


async def cmd_watch(args) -> int:
    from bleak import BleakClient

    capture = capture_format.new_capture(args.note, started=datetime.now(timezone.utc).isoformat())
    capture["links"] = []
    path = CAPTURES / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{args.out}.json"
    began = time.monotonic()
    end = began + args.hours * 3600
    saved = began

    def elapsed() -> int:
        return int((time.monotonic() - began) * 1000)

    def link(event: str) -> None:
        capture["links"].append({"t": elapsed(), "event": event})
        print(f"{elapsed() / 60000:7.1f} min  {event}")

    def on_notify(_, data: bytearray) -> None:
        capture_format.add_packet(capture, elapsed(), "rx", bytes(data))
        if args.verbose:
            print(f"{elapsed() / 60000:7.1f} min  rx {bytes(data).hex()}")

    def save_now() -> None:
        nonlocal saved
        capture_format.save(capture, path)
        saved = time.monotonic()

    async def ask_battery(client) -> None:
        packet = build_packet("03", CHECKSUM)
        capture_format.add_packet(capture, elapsed(), "tx", packet)
        await client.write_gatt_char(COMMAND_WRITE, packet, response=False)

    try:
        while time.monotonic() < end:
            found = await find(args.name_prefix, args.timeout)
            if not found:
                link("non trovato")
                await asyncio.sleep(30)
                continue
            lost = asyncio.Event()
            try:
                async with BleakClient(found[0], disconnected_callback=lambda _: lost.set()) as client:
                    link("collegato")
                    await client.start_notify(COMMAND_NOTIFY, on_notify)
                    await client.start_notify(BIG_NOTIFY, on_notify)
                    if args.poll_every:
                        # Confronto: solo la batteria, poi si scollega fino al giro dopo.
                        await ask_battery(client)
                        await asyncio.sleep(5)
                    else:
                        next_battery = time.monotonic()
                        while time.monotonic() < end and not lost.is_set():
                            if args.battery_every and time.monotonic() >= next_battery:
                                await ask_battery(client)
                                next_battery = time.monotonic() + args.battery_every * 60
                            if time.monotonic() - saved >= SAVE_EVERY_S:
                                save_now()
                            try:
                                await asyncio.wait_for(lost.wait(), timeout=5)
                            except asyncio.TimeoutError:
                                pass
                link("perso" if lost.is_set() else "scollegato")
            except Exception as error:  # noqa: BLE001 — un errore del Bluetooth non deve fermare 24 ore di prova
                link(f"errore {type(error).__name__}")
                await asyncio.sleep(10)
            if args.poll_every and time.monotonic() < end:
                save_now()
                await asyncio.sleep(max(0.0, args.poll_every * 60 - 5))
    finally:
        save_now()
        print(f"Salvati {len(capture['packets'])} pacchetti in {path.relative_to(CAPTURES.parent.parent)}")
    return 0


async def cmd_watch_summary(args) -> int:
    for line in watch_summary(capture_format.load(Path(args.file))):
        print(line)
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("scan", "services", "capture"):
        s = sub.add_parser(name)
        s.add_argument("--name-prefix", default="R09")
        s.add_argument("--timeout", type=float, default=8.0)
    capture = sub.choices["capture"]
    capture.add_argument("--write-uuid", required=True)
    capture.add_argument("--notify-uuid", required=True)
    capture.add_argument("--send", action="append", default=[])
    capture.add_argument("--checksum", choices=["mod255", "mod256", "none"], required=True)
    capture.add_argument("--wait", type=float, default=5.0)
    capture.add_argument("--gap", type=float, default=0.5)
    capture.add_argument("--out", required=True)
    capture.add_argument("--note", default="")
    watch = sub.add_parser("watch")
    watch.add_argument("--name-prefix", default=RING_NAME_PREFIX)
    watch.add_argument("--timeout", type=float, default=8.0)
    watch.add_argument("--hours", type=float, default=24.0)
    watch.add_argument("--battery-every", type=float, default=30.0, help="minuti tra due letture della batteria; 0 = mai")
    watch.add_argument("--poll-every", type=float, default=0.0, help="minuti tra due collegamenti brevi; 0 = collegamento continuo")
    watch.add_argument("--out", required=True)
    watch.add_argument("--note", default="")
    watch.add_argument("--verbose", action="store_true")
    summary = sub.add_parser("watch-summary")
    summary.add_argument("file")
    return p


def main(argv: list[str]) -> int:
    args = parser().parse_args(argv)
    handler = {
        "scan": cmd_scan,
        "services": cmd_services,
        "capture": cmd_capture,
        "watch": cmd_watch,
        "watch-summary": cmd_watch_summary,
    }[args.command]
    return asyncio.run(handler(args))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
