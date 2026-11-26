"""Riassume una cattura: per ogni opcode (primo byte dei pacchetti da 16 byte) e direzione, quanti pacchetti, la
distanza nel tempo e i primi esempi in esadecimale. Serve a leggere i comandi senza incollare l'intera cattura.

Uso: python tools/capture_summary.py local-data/captures/produttore-sync.json [--examples 2] [--from-ms 0 --to-ms 99999999]
       python tools/capture_summary.py <file> --new-vs <base.json> [--ignore 01,15,43]   (solo i pacchetti nuovi)
       python tools/capture_summary.py <file> --op 43,15 [--from-ms N --to-ms N]   (tutti i pacchetti di quegli opcode)

Stampa anche i pacchetti che NON sono da 16 byte (la lunghezza e il primo byte), che possono essere un altro canale.
Una cattura non contiene l'indirizzo dell'anello, quindi il riassunto si può incollare.
"""
import argparse
import glob
import sys
from collections import Counter, defaultdict
from pathlib import Path

import capture_format


def summarise(capture: dict, examples: int = 2, from_ms: int = 0, to_ms: int | None = None) -> dict:
    by_key: dict[tuple[int, str], list[tuple[int, bytes]]] = defaultdict(list)
    odd: Counter = Counter()
    for packet in capture["packets"]:
        t = packet["t"]
        if t < from_ms or (to_ms is not None and t > to_ms):
            continue
        data = bytes.fromhex(packet["hex"])
        if len(data) == capture_format.FRAME_LENGTH:
            by_key[(data[0], packet["dir"])].append((t, data))
        elif data:
            odd[(len(data), data[0], packet["dir"])] += 1
    rows = []
    for (opcode, direction), items in sorted(by_key.items()):
        rows.append(
            {
                "opcode": opcode,
                "dir": direction,
                "count": len(items),
                "first_t": items[0][0],
                "last_t": items[-1][0],
                "examples": [data.hex() for _, data in items[:examples]],
            }
        )
    return {"frames": rows, "odd": sorted(odd.items())}


def dump(capture: dict, opcodes: set[int], from_ms: int = 0, to_ms: int | None = None) -> list[str]:
    """Ogni pacchetto (di qualsiasi lunghezza) il cui primo byte e' in opcodes, in ordine di tempo."""
    lines = []
    for packet in capture["packets"]:
        t = packet["t"]
        if t < from_ms or (to_ms is not None and t > to_ms):
            continue
        data = bytes.fromhex(packet["hex"])
        if data and data[0] in opcodes:
            lines.append(f"{t:>8} {packet['dir']} {len(data):>3}  {data.hex()}")
    return lines


def novel(capture: dict, baseline: dict, ignore: set[int] | None = None) -> list[str]:
    """Pacchetti (di qualsiasi lunghezza, 16 byte o `bc`) che la cattura ha e la base no, uno per contenuto distinto, in ordine
    di tempo. Serve a vedere cosa cambia quando si accende una funzione nell'app del produttore. `ignore`: opcode da non mostrare
    (quelli che portano un'ora, come `01` e `15`, sono sempre diversi)."""
    seen = {p["hex"] for p in baseline["packets"]}
    lines = []
    for packet in capture["packets"]:
        data = bytes.fromhex(packet["hex"])
        if not data or packet["hex"] in seen or (ignore and data[0] in ignore):
            continue
        # Il firmware ha pacchetti da 56 e 244 byte (aggiornamento): non sono comandi.
        if len(data) in (56, 244) and data[0] != 0xBC:
            continue
        seen.add(packet["hex"])
        lines.append(f"{packet['t']:>8} {packet['dir']} {len(data):>3}  {data.hex()}")
    return lines


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    parser.add_argument("--examples", type=int, default=2)
    parser.add_argument("--from-ms", type=int, default=0)
    parser.add_argument("--to-ms", type=int, default=None)
    parser.add_argument("--new-vs", default="", help="file di base: stampa solo i pacchetti che la base non ha")
    parser.add_argument("--ignore", default="01,15,43", help="opcode (esadecimale, virgola) da non mostrare con --new-vs")
    parser.add_argument("--op", default="", help="opcode in esadecimale separati da virgola: stampa tutti i pacchetti")
    args = parser.parse_args(argv)
    names = [n for pattern in args.files for n in (sorted(glob.glob(pattern)) or [pattern])]
    for name in names:
        if args.new_vs:
            ignore = {int(x, 16) for x in args.ignore.split(",") if x}
            print(f"== {Path(name).name} (novita' rispetto a {Path(args.new_vs).name})")
            print("\n".join(novel(capture_format.load(Path(name)), capture_format.load(Path(args.new_vs)), ignore)))
            continue
        if args.op:
            codes = {int(x, 16) for x in args.op.split(",")}
            print(f"== {Path(name).name}")
            print("\n".join(dump(capture_format.load(Path(name)), codes, args.from_ms, args.to_ms)))
            continue
        result = summarise(capture_format.load(Path(name)), args.examples, args.from_ms, args.to_ms)
        print(f"== {Path(name).name}")
        for row in result["frames"]:
            print(f"op {row['opcode']:02x} {row['dir']}  x{row['count']}  t {row['first_t']}..{row['last_t']} ms")
            for example in row["examples"]:
                print(f"    {example}")
        for (length, opcode, direction), count in result["odd"]:
            print(f"non da 16 byte: {direction} lunghezza {length} primo byte {opcode:02x}  x{count}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
