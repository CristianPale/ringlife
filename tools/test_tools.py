"""Prove degli strumenti dello spike che non richiedono Bluetooth. Uso: python3 -m unittest tools/test_tools.py"""
import struct
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import capture_format  # noqa: E402
import checksum_check  # noqa: E402
import btsnoop_to_capture  # noqa: E402
import ringtool  # noqa: E402
import capture_summary  # noqa: E402


# Costruiti a runtime: il controllo dei segreti del repo rifiuta, giustamente, un indirizzo MAC scritto per intero.
FAKE_MAC = ":".join(["aa", "bb", "cc", "dd", "ee", "ff"])
FAKE_MAC_DASH = "-".join(["aa", "bb", "cc", "dd", "ee", "ff"])


def frame(body: bytes, kind: str) -> bytes:
    body = body.ljust(15, b"\x00")
    return body + bytes([checksum_check.checksum(body, kind)])


class CaptureFormatTest(unittest.TestCase):
    def test_round_trip(self):
        capture = capture_format.new_capture("batteria al 60%")
        capture_format.add_packet(capture, 0, "tx", frame(b"\x03", "mod256"))
        capture_format.add_packet(capture, 40, "rx", frame(b"\x03\x3c", "mod256"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "c.json"
            capture_format.save(capture, path)
            self.assertEqual(capture_format.load(path), capture)

    def test_refuses_a_mac_address_in_the_note_or_in_a_packet(self):
        capture = capture_format.new_capture(f"anello {FAKE_MAC.upper()}")
        self.assertTrue(any("MAC" in p for p in capture_format.validate(capture)))
        capture = capture_format.new_capture()
        capture_format.add_packet(capture, 0, "rx", bytes.fromhex("aabbccddeeff"))
        # Sei byte esadecimali di seguito non sono un MAC con i due punti: il controllo è sul testo con separatori.
        self.assertEqual(capture_format.validate(capture), [])
        capture["note"] = f"ho annotato {FAKE_MAC_DASH}"
        self.assertTrue(capture_format.validate(capture))
        # Un intervallo di orari mescola `:` e `-`: non è un MAC.
        capture["note"] = "misura dalle 16:19:47-16:20:16"
        self.assertEqual(capture_format.validate(capture), [])

    def test_refuses_a_wrong_direction_time_or_hex(self):
        capture = capture_format.new_capture()
        capture["packets"] = [
            {"t": 5, "dir": "xx", "hex": "00"},
            {"t": 3, "dir": "rx", "hex": "0g"},
            {"t": 9, "dir": "rx", "hex": "abc"},
        ]
        problems = capture_format.validate(capture)
        self.assertEqual(len(problems), 4)

    def test_save_does_not_write_an_invalid_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            with self.assertRaises(ValueError):
                capture_format.save(capture_format.new_capture(FAKE_MAC.upper()), path)
            self.assertFalse(path.exists())

    def test_frames_keeps_only_16_byte_packets_in_the_asked_direction(self):
        capture = capture_format.new_capture()
        capture_format.add_packet(capture, 0, "tx", frame(b"\x01", "mod256"))
        capture_format.add_packet(capture, 1, "rx", bytes(5))
        capture_format.add_packet(capture, 2, "rx", frame(b"\x02", "mod256"))
        self.assertEqual(len(capture_format.frames(capture)), 2)
        self.assertEqual(len(capture_format.frames(capture, "rx")), 1)


class ChecksumCheckTest(unittest.TestCase):
    def test_the_two_formulas_diverge_from_255(self):
        body = bytes([255]) + bytes(14)
        self.assertEqual(checksum_check.checksum(body, "mod255"), 0)
        self.assertEqual(checksum_check.checksum(body, "mod256"), 255)

    def test_picks_the_formula_that_fits_all_frames(self):
        frames = [frame(bytes([255, 1]), "mod256"), frame(bytes([9]), "mod256")]
        result = checksum_check.analyse(frames)
        self.assertEqual(result["fit"], {"mod255": 1, "mod256": 2})
        self.assertIn("mod256", checksum_check.verdict(result))
        frames = [frame(bytes([255, 1]), "mod255"), frame(bytes([9]), "mod255")]
        self.assertIn("mod255", checksum_check.verdict(checksum_check.analyse(frames)))

    def test_says_when_the_frames_cannot_tell_them_apart(self):
        result = checksum_check.analyse([frame(bytes([1]), "mod256"), frame(bytes([2]), "mod256")])
        self.assertEqual(result["discriminating"], 0)
        self.assertIn("non si distinguono", checksum_check.verdict(result))

    def test_says_when_neither_fits(self):
        bad = bytes(15) + bytes([7])
        self.assertIn("Nessuna delle due", checksum_check.verdict(checksum_check.analyse([bad])))

    def test_no_frames(self):
        self.assertIn("Nessun pacchetto", checksum_check.verdict(checksum_check.analyse([])))


class BuildPacketTest(unittest.TestCase):
    def test_pads_and_adds_the_chosen_checksum(self):
        packet = ringtool.build_packet("ff01", "mod256")
        self.assertEqual(len(packet), 16)
        self.assertEqual(packet[15], 0)
        self.assertEqual(ringtool.build_packet("ff01", "mod255")[15], 1)

    def test_none_sends_exactly_what_was_written(self):
        self.assertEqual(ringtool.build_packet("01 02 03", "none"), bytes([1, 2, 3]))

    def test_refuses_more_than_15_bytes(self):
        with self.assertRaises(ValueError):
            ringtool.build_packet("00" * 16, "mod256")


def snoop_record(sent: bool, h4: bytes, t: int) -> bytes:
    return struct.pack(">IIIIq", len(h4), len(h4), 0 if sent else 1, 0, t) + h4


def acl_att(att: bytes) -> bytes:
    l2cap = struct.pack("<HH", len(att), 0x0004) + att
    return bytes([0x02]) + struct.pack("<HH", 0x0040, len(l2cap)) + l2cap


def snoop_file(*records: bytes) -> bytes:
    return b"btsnoop\x00" + struct.pack(">II", 1, 1002) + b"".join(records)


class BtsnoopTest(unittest.TestCase):
    WRITE = bytes([0x52]) + struct.pack("<H", 0x0012) + bytes(range(16))
    NOTIFY = bytes([0x1B]) + struct.pack("<H", 0x0014) + bytes(range(16, 32))

    def test_keeps_writes_sent_and_notifications_received(self):
        data = snoop_file(
            snoop_record(True, acl_att(self.WRITE), 5_000_000),
            snoop_record(False, acl_att(self.NOTIFY), 5_040_000),
            snoop_record(False, acl_att(bytes([0x0B, 1, 2])), 5_050_000),  # risposta a una lettura: non serve
            snoop_record(True, bytes([0x01, 0x03, 0x0C, 0x00]), 5_060_000),  # comando HCI: non è ATT
        )
        capture = btsnoop_to_capture.convert(data)
        self.assertEqual([(p["dir"], p["t"]) for p in capture["packets"]], [("tx", 0), ("rx", 40)])
        self.assertEqual(capture["packets"][0]["hex"], bytes(range(16)).hex())
        self.assertEqual(capture_format.validate(capture), [])

    def test_can_keep_a_single_handle(self):
        data = snoop_file(snoop_record(True, acl_att(self.WRITE), 0), snoop_record(False, acl_att(self.NOTIFY), 1000))
        capture = btsnoop_to_capture.convert(data, only_handle=0x0014)
        self.assertEqual([p["dir"] for p in capture["packets"]], ["rx"])

    def test_refuses_what_is_not_a_btsnoop_log(self):
        with self.assertRaises(ValueError):
            btsnoop_to_capture.convert(b"nonbtsnoop" + bytes(20))
        with self.assertRaises(ValueError):
            btsnoop_to_capture.convert(b"btsnoop\x00" + struct.pack(">II", 1, 1001))


class ExpandTest(unittest.TestCase):
    def test_expands_wildcards_the_way_a_unix_shell_would(self):
        import tempfile

        with tempfile.TemporaryDirectory() as folder:
            for name in ("b.json", "a.json", "nota.txt"):
                open(os.path.join(folder, name), "w").close()
            found = checksum_check.expand([os.path.join(folder, "*.json")])
            self.assertEqual([os.path.basename(n) for n in found], ["a.json", "b.json"])

    def test_keeps_a_name_that_matches_nothing_so_the_error_names_the_file(self):
        self.assertEqual(checksum_check.expand(["manca.json"]), ["manca.json"])


class SummaryTest(unittest.TestCase):
    def _capture(self):
        capture = capture_format.new_capture("t")
        capture_format.add_packet(capture, 10, "tx", bytes.fromhex("03" + "00" * 14 + "03"))
        capture_format.add_packet(capture, 20, "rx", bytes.fromhex("0363010000000000000000000000" + "0067"))
        capture_format.add_packet(capture, 30, "rx", bytes.fromhex("0363000000000000000000000000" + "0066"))
        capture_format.add_packet(capture, 40, "rx", bytes.fromhex("bc2700"))
        return capture

    def test_groups_by_opcode_and_direction_with_examples(self):
        result = capture_summary.summarise(self._capture(), examples=1)
        rows = {(r["opcode"], r["dir"]): r for r in result["frames"]}
        self.assertEqual(rows[(3, "tx")]["count"], 1)
        self.assertEqual(rows[(3, "rx")]["count"], 2)
        self.assertEqual(len(rows[(3, "rx")]["examples"]), 1)
        self.assertEqual((rows[(3, "rx")]["first_t"], rows[(3, "rx")]["last_t"]), (20, 30))

    def test_reports_packets_that_are_not_16_bytes_apart(self):
        self.assertEqual(capture_summary.summarise(self._capture())["odd"], [((3, 0xBC, "rx"), 1)])

    def test_can_restrict_to_a_time_window(self):
        result = capture_summary.summarise(self._capture(), from_ms=25)
        self.assertEqual([(r["opcode"], r["dir"]) for r in result["frames"]], [(3, "rx")])
        self.assertEqual(result["frames"][0]["count"], 1)

    def test_dump_lists_every_packet_of_an_opcode_in_time_order_any_length(self):
        lines = capture_summary.dump(self._capture(), {0x03, 0xBC})
        self.assertEqual(len(lines), 4)
        self.assertTrue(lines[0].lstrip().startswith("10 tx"))
        self.assertTrue(lines[-1].endswith("bc2700"))
        self.assertEqual(len(capture_summary.dump(self._capture(), {0xBC})), 1)

    def test_novel_lists_only_packets_the_baseline_lacks_once_each(self):
        base = capture_format.new_capture("b")
        capture_format.add_packet(base, 1, "tx", bytes.fromhex("03" + "00" * 14 + "03"))
        new = capture_format.new_capture("n")
        capture_format.add_packet(new, 5, "tx", bytes.fromhex("03" + "00" * 14 + "03"))
        capture_format.add_packet(new, 6, "tx", bytes.fromhex("1602010500000000000000000000001e"))
        capture_format.add_packet(new, 7, "tx", bytes.fromhex("1602010500000000000000000000001e"))
        capture_format.add_packet(new, 8, "tx", bytes.fromhex("bc2a0100ff00ff"))
        capture_format.add_packet(new, 9, "tx", bytes.fromhex("012611161425390600000000000000c6"))
        lines = capture_summary.novel(new, base, ignore={0x01})
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].endswith("1602010500000000000000000000001e"))
        self.assertTrue(lines[1].endswith("bc2a0100ff00ff"))



class WatchSummaryTest(unittest.TestCase):
    def test_counts_packets_per_hour_with_the_kind_of_spontaneous_event_and_the_battery_drop(self):
        capture = capture_format.new_capture("continuo")
        capture["links"] = [{"t": 0, "event": "collegato"}, {"t": 5_000_000, "event": "perso"}]
        capture_format.add_packet(capture, 0, "tx", frame(b"\x03", "mod256"))
        capture_format.add_packet(capture, 100, "rx", frame(b"\x03\x50\x00", "mod256"))
        capture_format.add_packet(capture, 200_000, "rx", frame(b"\x73\x12\x00\x00\x0d", "mod256"))
        capture_format.add_packet(capture, 300_000, "rx", frame(b"\x73\x12\x00\x00\x1a", "mod256"))
        capture_format.add_packet(capture, 7_200_100, "rx", frame(b"\x03\x4e\x00", "mod256"))
        lines = ringtool.watch_summary(capture)
        self.assertIn("  ora   0: 03 ×1, 73 12 ×2", lines)
        self.assertIn("  ora   2: 03 ×1", lines)
        self.assertIn("  calo fuori carica: 2 punti in 2.0 h, 1.00 punti all'ora", lines)
        self.assertIn("Collegamento: collegato ×1, perso ×1", lines)

    def test_does_not_count_the_battery_drop_while_charging(self):
        capture = capture_format.new_capture("carica")
        capture_format.add_packet(capture, 0, "rx", frame(b"\x03\x40\x01", "mod256"))
        capture_format.add_packet(capture, 3_600_000, "rx", frame(b"\x03\x50\x01", "mod256"))
        lines = ringtool.watch_summary(capture)
        self.assertIn("     1.0 h   80% in carica", lines)
        self.assertFalse(any("calo" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
