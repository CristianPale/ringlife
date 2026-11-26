# Colmi R09 Bluetooth protocol

This document describes the Bluetooth Low Energy protocol of the Colmi R09 smart ring, as RingLife uses it. It was reverse-engineered from observed traffic between the ring and the vendor app, for interoperability. RingLife is not affiliated with Colmi. Captures are never published: every example below is synthetic.

Sources: HCI snoop logs and nRF Connect sessions with an R09 on firmware 3.00.03. Third-party code, such as the Colmi support in Gadgetbridge, served only as a hint. Every format below was checked on captures, and no third-party code is copied.

The parsers live in [`mobile/src/app/ring/ble/ring-protocol.ts`](../mobile/src/app/ring/ble/ring-protocol.ts) and [`mobile/src/app/ring/ble/frame.ts`](../mobile/src/app/ring/ble/frame.ts). Their tests use synthetic frames like the ones below.

Status labels:

| Label | Meaning |
|---|---|
| **Verified** | Checked on the ring: decoded values matched what the vendor app showed, or the ring's behavior confirmed the meaning. |
| **Hypothesis** | Consistent with the data seen, not confirmed. |
| **By analogy** | RingLife sends it, but no capture shows it. It is derived from a sibling command. |

Notation: bytes in hexadecimal, separated by spaces. `LE` = little-endian, `BE` = big-endian, `BCD` = binary-coded decimal (`0x26` means 26). `cs` = checksum byte. `…` = zero bytes up to the end of the frame.

## Connection

- Advertised name: `COLMI Ring 2` (not `R09_…`). RingLife scans for the name prefix `COLMI`.
- The ring accepts one central at a time. While the vendor app or Gadgetbridge is connected, other apps do not see the ring.
- A new ring, never connected to any app, answers commands.
- The ring has two vendor services. Each one has a write characteristic and a notify characteristic:

| Service | Write | Notify | Use |
|---|---|---|---|
| `6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` (write, write without response) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (notify) | Command channel: 16-byte frames |
| `de5bf728-d711-4e47-af26-65e3012a5dc7` | `de5bf72a-d711-4e47-af26-65e3012a5dc7` (write, write without response) | `de5bf729-d711-4e47-af26-65e3012a5dc7` (notify) | Long channel: variable-length `bc` messages |

- Other services: Generic Access (`1800`), Generic Attribute (`1801`), Device Information (`180a`, read-only: manufacturer, model, firmware revision, hardware revision) and `fee7` (characteristics `fea1` notify and `fea2` write/indicate). A service like `fee7` usually serves firmware updates. RingLife never uses it.
- The UUIDs are the same on every ring. They were listed with `tools/ringtool.py scan` and `services` on a new R09.

### Firmware

- All formats here were observed on firmware `3.00.03`, the version the vendor app reports. The vendor app updated the ring to this version at the first connection. Only the first battery checks ran on the factory firmware.
- RingLife reads Firmware Revision (`2a26`) and Hardware Revision (`2a27`) from Device Information at every sync. It extracts a version `n.nn.nn` from the text and compares it with `3.00.03`.
- RingLife never updates the firmware. See [Firmware update](#firmware-update-bc-01-to-bc-05).

## Time

The ring has no time zone. It keeps a local wall-clock time, set with command `01`. Every timestamp the ring returns is in that local time.

- Set the time at every connection. The vendor app does it too.
- Convert ring timestamps to UTC with the phone's UTC offset at sync time. Keep that offset with the sync: it lets you correct data read after a time zone or daylight saving change. RingLife sends it as `tzOffsetMin` (see [api.md](api.md)).
- Day 0 means today, from the ring's local midnight. History requests reach back to day 6.

## Command channel

### Frame

Every command and every reply on the command channel is exactly 16 bytes:

| Byte | Content |
|---|---|
| 0 | Opcode. A reply repeats the opcode of its request. |
| 1–14 | Payload, padded with zeros. |
| 15 | Checksum: `sum(bytes 0–14) & 0xff`, the byte sum modulo 256. |

**Verified: modulo 256.** In a capture of the vendor app syncing, all 583 16-byte frames match modulo 256. Only frames whose byte sum reaches 255 tell the two formulas apart: 220 frames do, and none of them matches modulo 255, so only 363 frames match modulo 255. Some third-party notes for related Colmi rings describe a modulo-255 checksum. That does not hold for the R09.

Example (battery request): `03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 03`.

The ring answers within about 25–250 ms. Multi-frame replies (heart rate, stress, HRV, steps) arrive in a quick burst. Buffer the frames until the last index has arrived.

### Commands at a glance

| Opcode | Purpose | Status | RingLife API metric |
|---|---|---|---|
| `01` | Set time | Verified | none |
| `03` | Battery level and charging state | Charging verified; level hypothesis | none |
| `15` | Heart-rate history | Verified | `HR` |
| `16` | Heart-rate measurement setting | Verified | none |
| `2c` | Automatic SpO2 setting | On verified; off by analogy | none |
| `36` | Stress setting | On verified; off by analogy | none |
| `37` | Stress history | Verified | `STRESS` |
| `38` | HRV setting | On verified; off by analogy | none |
| `39` | HRV history | Verified | `HRV` |
| `3a` | Temperature setting | On verified; off by analogy | none |
| `43` | Steps history | Verified | `STEPS` |
| `48` | Keep-alive | Hypothesis | none |
| `69`, `6a` | Real-time measurement start and stop | Verified for heart rate, SpO2, stress, HRV and temperature | none (on-demand measurements stay on the phone) |
| `73` | Unsolicited activity events | Hypothesis | none |
| `77`, `78` | Workout control and live heart rate | Verified | none (live values stay on the phone) |

Sleep, SpO2 and temperature history use the [long channel](#long-channel-bc).

### Set time (`01`)

- Request: `01 <yy> <MM> <dd> <hh> <mm> <ss> 06 …`. Bytes 1–6 are BCD, in the phone's local time. Byte 7 is always `06` in the vendor app's frames. Its meaning is unknown.
- Example (2025-01-02 03:04:05): `01 25 01 02 03 04 05 06 00 00 00 00 00 00 00 3b`.
- Reply: starts with `01 01 00 00 02`. Meaning unknown.
- The vendor app sends this command at every connection.

### Battery (`03`)

- Request: `03` with an empty payload: `03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 03`.
- Reply, one frame: `03 <level> <charging> …`.
  - Byte 1: charge level in percent. **Hypothesis**: RingLife reads it as a percentage, capped at 100. It has not yet been compared with the vendor app.
  - Byte 2: `01` charging, `00` not charging. **Verified** by taking the ring off the charger between two reads.
  - Bytes 3–14: zero.
- Examples (synthetic level of 80 %): on the charger `03 50 01 00 00 00 00 00 00 00 00 00 00 00 00 54`; off the charger `03 50 00 00 00 00 00 00 00 00 00 00 00 00 00 53`.
- The battery level is device state, not a sample. RingLife shows it in the app and does not upload it.
- This command cannot decide the checksum formula: its byte sums stay below 255.

### Steps history (`43`)

- Request: `43 <day> 0f 00 5f 01 …`, with day 0 = today, up to 6. Bytes 2–5 are always `0f 00 5f 01`. Their meaning is unknown.
- Day without data: one frame, `43 ff 00 00 …` (`43 ff 00 01 …` for day 0).
- Day with data: a header frame `43 f0 <n> 01 …`, where `n` is the number of frames that follow. Then `n` frames, one for each hour with activity:

| Byte | Content |
|---|---|
| 0 | `43` |
| 1–3 | Date: year (2 digits), month, day, BCD |
| 4 | Quarter-hour index from midnight, 0–95. The values seen are multiples of 4, one frame per hour: hour of day = value / 4. |
| 5 | Frame index, 0 to n − 1 |
| 6 | `n` |
| 7–8 | Calories, LE, in hundredths of a kilocalorie |
| 9–10 | Steps in that hour, LE |
| 11–12 | Distance in metres, LE |
| 13–14 | `00` |
| 15 | Checksum |

- **Verified**: the day totals of calories, steps and distance matched the vendor app.
- A bucket starts on the full hour. Hours without steps have no frame. The first frame of the day is the hour in which the ring was put on. Times follow the clock set with `01`.
- Example (synthetic): `43 25 01 02 34 00 09 c2 01 8d 00 6a 00 00 00 62` = 2 January 2025, quarter 52 (13:00–14:00), frame 0 of 9, 4.50 kcal, 141 steps, 106 m.
- RingLife uploads each frame as one `STEPS` sample, stamped at the end of the hour. It does not upload the calories.

### Heart-rate history (`15`)

- Request: `15 <t LE 4> …`. `t` is the start of the requested day in seconds since the Unix epoch, counted **in local time**, not UTC. **Verified.**
- Example (local midnight of 2 January 2025, `t` = 1735776000): `15 00 d7 75 67 00 00 00 00 00 00 00 00 00 00 c8`.
- Reply: a series of 16-byte frames, each starting with `15 <index>`:

| Index | Content |
|---|---|
| 0 (header) | `15 00 <n> <interval>`. `n` = total number of frames, header included (24 seen). `interval` = minutes between samples (5 seen). |
| 1 | `15 01 <t LE 4> <9 values>` |
| 2 to n − 1 | `15 <index> <13 values> <cs>` |

- Each value is one byte: heart rate in beats per minute. `00` means no measurement.
- Number the values from 0 across all frames. Value `k` is at `k × interval` minutes after local midnight. With 24 frames, 9 + 22 × 13 = 295 values cover the 288 five-minute slots of a day.
- The timestamp in frame 1 echoes the request, not the midnight. The ring still returns values from midnight. The vendor app requests the six past days at their midnights (steps of 86400 s) and today with the current time. RingLife requests every day at its local midnight, so the echoed timestamp is the start of the slots.
- Day without samples: `15 ff …`.
- A full day arrives in one exchange, about 24 frames in half a second. Wait for the last index. RingLife drops the day if a frame is missing, rather than guess the times.
- **Verified**: after 5-minute measurement was switched on, the first non-zero value appeared in the next 5-minute slot, then one in every slot.
- Example (synthetic): `15 05 46 48 4a 00 00 00 00 00 00 00 00 00 00 f2` = frame 5, values 48 to 50 (04:00, 04:05 and 04:10 with a 5-minute interval): 70, 72 and 74 bpm.
- Periodic measurement is off on a new ring, so the history stays empty (`15 ff`) until it is switched on with `16`.

### Measurement settings (`16`, `2c`, `36`, `38`, `3a`)

The ring measures heart rate, SpO2, stress, HRV and temperature only while the matching setting is on. Heart rate, SpO2, stress and temperature were off on a new ring, and their histories were empty. Measurement starts when the setting is switched on and also runs during sleep. Expect at least a day before a history fills.

| Measurement | Read | Read reply | Switch on | Switch off |
|---|---|---|---|---|
| Heart rate | `16 01` | `16 01 <state> <interval> 05` | `16 02 01 <interval>` | `16 02 02 <interval>` |
| SpO2 (automatic) | `2c 01` | `2c 01 <state> <x>` | `2c 02 01` | `2c 02 00` (by analogy) |
| Stress | `36 01` | `36 01 <state>` | `36 02 01` | `36 02 00` (by analogy) |
| HRV | `38 01` | `38 01 <state>` | `38 02 01 0a 60` | `38 02 00 0a 60` (by analogy) |
| Temperature | `3a 03 01` | `3a 03 01 <state>` | `3a 03 02 01` | `3a 03 02 00` (by analogy) |

- **Heart rate (`16`)**, **verified** by writing to an R09. State `01` = on, `02` = off. The interval is in minutes.
  - Write reply: `16 02 01 00 …`.
  - Example: `16 02 01 05` switches on measurement every 5 minutes. Reading back gives `16 01 01 05 05`.
  - A new ring replies `16 01 02 1e 05`: off, 30 minutes.
  - The last byte of the read reply was `05` at both 5 and 30 minutes. Its meaning is unknown.
  - To switch off, RingLife sends `16 02 02 1e`.
- **SpO2 (`2c`)**: switch-on **verified** from a capture of the vendor app.
  - A new ring replies `2c 01 00 1e`: off. The meaning of `1e` (30) is unknown.
  - After switch-on, the reply is `2c 01 01 00`. Byte 2 is the state. Byte 3 is not a fixed interval: it changed from `1e` to `00`.
  - The vendor app does not let the user change the SpO2 interval.
- **Stress (`36`)**: switch-on **verified** from a capture. Off, the read reply is `36 01 00`; on, `36 01 01`. Byte 2 is the state.
- **HRV (`38`)**: switch-on **verified** from a capture. The write reply is `38 02 01`. After switch-on, the read reply is `38 01 01`.
  - The two bytes after the state, `0a` (10) and `60` (96), have unknown meaning. Perhaps an interval in minutes and a duration. Send them unchanged.
- **Temperature (`3a`)**: switch-on **verified** from a capture. The format is `3a 03 <01 read | 02 write> <state>`. Off, the read reply is `3a 03 01 00`.

### Stress and HRV history (`37`, `39`)

**Verified**: the last value of each history matched the value shown by the vendor app.

- Request: `37 <day> …` (stress) or `39 <day> …` (HRV), with day 0 = today, up to 6.
- Day without data: `<op> ff …`.
- Reply: a header `<op> 00 <n> <interval>`, then frames `<op> <index> <13 bytes>` for index 1 to n − 1. Seen: `n` = 5, interval = 30 minutes.
- Join the 13 data bytes of all frames in index order. The result is a series of slots from local midnight: slot `k` starts at `k × interval` minutes. Four frames give 52 bytes, enough for the 48 one-byte slots of a day.
- **Stress**: one byte per slot, on the ring's own scale (the same numbers the vendor app shows). `0` = no measurement.
- **HRV**: two bytes per slot, **big-endian**, in milliseconds. `0` = no measurement. A pair can span two frames.
- Example (synthetic stress): the header `37 00 05 1e 00 00 00 00 00 00 00 00 00 00 00 5a`, then `37 01 00 00 2b 24 00 00 00 00 00 00 00 00 00 87` = slots 0 and 1 empty, slot 2 (01:00) = 43, slot 3 (01:30) = 36.
- RingLife drops the day if a frame is missing.

### Real-time measurement (`69`, `6a`)

- Start: `69 <type> …`. **Verified** types: `01` heart rate (`69 01 00`), `03` SpO2, `08` stress, `0a` HRV and `0b` temperature (`69 <type> 25`, see below).
- Reply, about two frames per second until the measurement stops: `69 <type> <error> <value> …`.
  - Heart rate: `error` = `00`, `value` = bpm.
  - `value` stays `00` until the ring locks on the signal, after about 15 s. Then it stays stable.
  - Bytes 6–7 vary independently of heart rate. Meaning unknown, perhaps a signal level. RingLife ignores them.
- Stop: the vendor app sends `6a <type> <last value>`, for example `6a 01 48` after a synthetic 72 bpm. The ring echoes it.
- The ring stops on its own after about 30 s. A new start locks on from scratch, which takes 30 s or more. For continuous heart rate, use a workout.

#### SpO2, stress and HRV on demand (types `03`, `08`, `0a`)

**Verified** on a capture of the vendor app's manual measurements. Same pattern as the temperature below.

- Start: `69 <type> 25`: `69032500000000000000000000000091`, `69082500000000000000000000000096`, `690a2500000000000000000000000098`. About one frame every half second; `error` = `00`.
- SpO2 (`03`): `00` for about 25 s, then `69 03 00 <percent> 01 00 …`. Byte 4 is `01` with a value, meaning unknown. The value alternates between two close numbers. The vendor app stops with `6a 03 00` about 3 s after the first value; the ring answers `6a 03 <value>`.
- Stress (`08`): `00` for about 25 s (bytes 6–7 start changing after about 15 s), then `69 08 00 <level> 00 00 <b6 b7> 02 …`, a different level in every frame. The vendor app stops with `6a 08 00` about 30 s after the start; the ring answers `6a 08 00`.
- HRV (`0a`): `00` for about 55 s (bytes 6–7 change after about 15 s), then a **single** frame `69 0a 00 <ms> 00 00 <b6 b7> 02 …`. The vendor app stops at once and puts the value in the stop: `6a 0a <ms>`; the ring answers `6a 0a 00`.
- Examples (synthetic): `69 03 00 61 01 …` = 97 %; `69 08 00 20 00 00 c2 02 02 …` = stress 32; `69 0a 00 30 00 00 b0 02 02 …` = 48 ms, stop `6a 0a 30`.
- RingLife collects 6 values (SpO2), 9 (stress) or 1 (HRV), or stops at three equal values in a row, and keeps the middle one. Which value the vendor app shows for SpO2 and stress is not confirmed.

#### Temperature on demand (type `0b`)

**Verified** on a capture of the vendor app's manual temperature measurement.

- Start: `69 0b 25` (`690b2500000000000000000000000099`). The meaning of `25` is unknown; RingLife sends it unchanged.
- Reply, about one frame every half second: `69 0b <error> <value> 00 00 <b6 b7> 02 00 …`.
  - `error`: `00` in the capture.
  - `value`: tenths of a degree Celsius above 20, as in the [temperature history](#temperature-bc-25). It stays `00` for about 25 s, then repeats the same value.
  - Bytes 6–7 change in every frame, also while the value is `00`. Meaning unknown, perhaps a raw sensor level. RingLife ignores them.
- Stop: `6a 0b 00` (`6a0b0000000000000000000000000075`). The ring answers `6a 0b <last value>`. The vendor app stops about 30 s after the start.
- Example (synthetic): `69 0b 00 00 00 00 85 02 02 …` (still measuring), then `69 0b 00 a6 00 00 9c 02 02 …` = 36.6 °C, stop, reply `6a 0b a6`.
- RingLife collects up to 6 values (three equal in a row are enough) and keeps the middle one, then always sends the stop, also after an error. Without a value within 60 s (90 s for HRV), or if the frames stop first, the measurement failed.
- Whether an on-demand measurement also enters the ring's history is unknown.

### Workout and live heart rate (`77`, `78`)

Observed in a capture of a short workout started in the vendor app.

- Control: `77 <action> <sport> …`. Actions: `01` start, `02` pause, `03` resume, `04` end. The capture used sport `04`. Other sport codes are unknown.
- The vendor app sends `77 01 04`, then `77 03 04` at once. To finish, it sends `77 02 04` and, about 2 s later, `77 04 04`.
- Replies: `77 01 00 <start LE 4>` to the start, where `start` uses the same local-time seconds as the history timestamps. `77 00 …` to the other actions.
- The ring also sends the events `73 01` at the start and `73 07` at the end.
- Data: the ring sends one frame per second, unprompted. No keep-alive is needed.

| Byte | Content |
|---|---|
| 0 | `78` |
| 1 | Sport |
| 2 | State: `01` running, `02` paused |
| 3–4 | Seconds since the start, BE, from 0 |
| 5 | Heart rate in bpm |
| 6–14 | `00` in the frames seen |
| 15 | Checksum |

- Heart rate is present from the first frame.
- Example (synthetic): `78 04 01 00 05 48 00 00 00 00 00 00 00 00 00 ca` = second 5, 72 bpm.
- After the workout, the vendor app reads a summary on the long channel: `bc 42`, `bc 43 … <start>`, `bc 44` and `bc 45`, the last with one heart-rate value about every 4 s. So the ring stores the workout. RingLife does not read the summary.
- RingLife sends start then resume, like the vendor app. If no `78` frame arrives for 3 s, it sends resume again. It finishes with pause then end.

### Unsolicited activity events (`73 12`)

- The ring sends these frames without a request: `73 12 00 00 <steps> 00 <calories BE 2> 00 00 <distance> 00 00 00 00 <cs>`.
- **Hypothesis**, consistent with a short walk:
  - Byte 4: steps of the ongoing count.
  - Bytes 6–7: calories in thousandths of a kilocalorie. The hourly history uses hundredths.
  - Byte 10: distance in metres.
- Not yet checked against a hand-counted walk.
- These frames could drive a live step counter. RingLife uses the hourly history (`43`) instead.

### Keep-alive (`48`)

The vendor app sends `48` with an empty payload every 1–60 s. The ring replies with the same frame. **Hypothesis**: a keep-alive, not data. RingLife does not send it.

## Long channel (`bc`)

Sleep, SpO2 and temperature history, and several setup messages of the vendor app, use the second service (`de5bf728-…`). Messages have a variable length:

| Bytes | Content |
|---|---|
| 0 | `bc` |
| 1 | Command |
| 2–3 | Data length, LE |
| 4–5 | CRC of the data, LE |
| 6… | Data |

- CRC: **CRC-16/MODBUS** of the data only. Initial value `ffff`, reflected polynomial `a001`, no final XOR. It is written little-endian. With no data the CRC is `ffff`.
- **Verified** on five requests of the vendor app and on one 51-byte reply:

| Data | CRC bytes in the message |
|---|---|
| (none) | `ff ff` |
| `00` | `bf 40` |
| `06` | `3f 42` |
| `ff` | `ff 00` |
| `00 01` | `c0 70` |
| `ff 01` | `81 80` |

- A reply can be longer than one notification. Join the notifications until 6 + length bytes have arrived. A message always starts with `bc`: discard a fragment that does not. Reset the buffer at every connection.
- Acknowledgement: the ring confirms some requests with `bc <cmd> 01 00 bf 40 00`, one data byte `00` meaning OK.

### Requests seen when the vendor app syncs

| Command | Request | Reply seen | Meaning |
|---|---|---|---|
| `30` | `bc 30 00 00 ff ff` | OK | Unknown. Perhaps a session start. |
| `4a` | `bc 4a 03 00 21 90 01 01 00` | OK | Unknown. Perhaps a setting. |
| `27` | `bc 27 02 00 c0 70 00 01`, then `bc 27 02 00 81 80 ff 01` | Sleep data | [Sleep history](#sleep-bc-27) (**verified**) |
| `41` | `bc 41 04 00 00 24 00 00 00 00` | OK | Unknown. Perhaps a setting. |
| `2a` | `bc 2a 01 00 ff 00 ff` | SpO2 data | [SpO2 history](#spo2-bc-2a) (**verified**) |
| `25` | `bc 25 01 00 3f 42 06` | Temperature data | [Temperature history](#temperature-bc-25) (**verified**) |
| `26` | `bc 26 01 00 bf 40 00` | The same message | Unknown. [Never send it.](#bc-26-never-send) |

On a new ring without data, `bc 2a` returns the empty message `bc 2a 00 00 ff ff`, and `bc 25` returns `bc 25 02 00 81 b8 00 1e`. The data `00 1e` is consistent with a temperature block header (today, interval 30) without values.

RingLife sends only `bc 27`, `bc 2a` and `bc 25`.

### Sleep (`bc 27`)

- Request: `bc 27 02 00 <crc> <x> 01`. The vendor app sends it twice: first with `x` = `00`, then with `x` = `ff`. **Hypothesis**: `ff` means all days. Both requests returned the same night. RingLife sends `bc 27 02 00 81 80 ff 01`.
- The ring first sends the acknowledgement `bc 3e 01 00 bf 40 00`, then the reply. The two can arrive almost at once.
- Reply: `bc 27 <length LE 2> <crc LE 2> <data>`. In the case seen, it fit in one notification.
- Data: `<days> { <days ago> <length> <start LE 2> <end LE 2> { <stage> <minutes> }* }*`

| Field | Bytes | Content |
|---|---|---|
| `days` | 1 | Number of day blocks that follow (1 seen). |
| `days ago` | 1 | 0 = the night that ends today. |
| `length` | 1 | Bytes that follow in this block, start and end included: 4 + 2 × segments. |
| `start`, `end` | 2 + 2 | Minutes after local midnight, LE. If `start` is greater than `end`, the night began the evening before. |
| segments | 2 each | `<stage> <duration in minutes>`, in time order. |

- **Verified** on real nights: the segment durations add up to `end − start` to the minute, and `length` = 4 + 2 × segments.
- The ring firmware classifies the stages. Codes seen: `02`, `03`, `04`, `05`. **Hypothesis**: `02` light, `03` deep, `04` REM, `05` awake. `02` is the most frequent code and `05` the shortest, as expected. Not yet compared with the vendor app. RingLife drops a night that contains an unknown code.
- The sleep belongs to the wake-up day. Times follow the clock set by the last `01`.
- Example (synthetic): start 23:00, end 06:00; segments light 120, deep 60, REM 60, awake 10, light 120, REM 50 = 420 minutes.
  - Data: `01 00 10 64 05 68 01 02 78 03 3c 04 3c 05 0a 02 78 04 32`
  - Full message: `bc 27 13 00 7f a4 01 00 10 64 05 68 01 02 78 03 3c 04 3c 05 0a 02 78 04 32`
- The ring keeps sleep data after a sync: a later read returns the same night unchanged.
- **The night in progress is already there.** A read before waking up returns the night with its end at the last classified minute. A later read returns the same night, with the same start and the real end. RingLife keeps the longer version of a night with the same start, on the phone and on the server.

### Temperature (`bc 25`)

**Verified**: the last value matched the vendor app.

- Request: `bc 25 01 00 3f 42 06`, as the vendor app sends it. The data byte is the number of days before today to include: on a ring worn for a week, `06` returned 7 blocks and `02` returned 3. A new ring returns only today's block.
- Data: one 50-byte block per day, `<days ago> <interval> { <value> }×48`.
  - `interval`: minutes between slots (30 seen). Slot `k` is at `k × interval` minutes after local midnight.
  - `value`: tenths of a degree Celsius above 20, so °C = `value / 10 + 20`. `0` = no measurement.
- Example (synthetic): `00 1e 00 a7 a9 …` = today, interval 30, slot 0 empty, slot 1 (00:30) 36.7 °C (`a7` = 167), slot 2 (01:00) 36.9 °C.
- The value is an estimate of skin temperature at the finger. Only its deviation from the personal baseline is meaningful (see [scores.md](scores.md)).

### SpO2 (`bc 2a`)

**Verified**: the last pair matched the vendor app.

- Request: `bc 2a 01 00 ff 00 ff`. Data `ff` selects all days.
- Data: one 49-byte block per day, `<days ago> { <min> <max> }×24`. One pair per hour from local midnight, in percent. `0` = no measurement.
- Example (synthetic): `00 00 00 61 62 …` = today, hour 0 without measurement, hour 1 (01:00–02:00) minimum 97 %, maximum 98 %.

### `bc 26`: never send

The vendor app sends `bc 26 01 00 bf 40 00` after it reads the temperature. The ring echoes it unchanged. It may acknowledge the read, or it may delete the data just read. Its meaning is unknown, so RingLife never sends it. Do not send it in your own tests either.

### Firmware update (`bc 01` to `bc 05`)

The vendor app updates the firmware with the long-channel commands `bc 01` to `bc 05`, in messages of 244 and 56 bytes. The payload contains the firmware identifier `RT09CR2_3.00.03_260929`. RingLife ignores these messages and never reproduces them: a failed update can leave the ring unusable.

## The current hour

The current hour is not over, so its latest values can still change. RingLife uploads only samples whose timestamp is not later than the phone clock. A steps sample is stamped at the end of its hour, so the current hour waits for the next sync.

## How RingLife reads the ring

The sync order, from [`ble-ring-source.ts`](../mobile/src/app/ring/ble/ble-ring-source.ts) and [`ring-sync.service.ts`](../mobile/src/app/ring/ring-sync.service.ts):

1. Connect and subscribe to the notifications of both channels.
2. Read Device Information (`2a26`, `2a27`).
3. Set the time (`01`).
4. Apply the measurement settings, in this order: `16`, `2c`, `36`, `38`, `3a`.
5. Read the battery (`03`).
6. For each day, from the oldest needed to today: steps (`43`), heart rate (`15`), stress (`37`), HRV (`39`). The first sync reads days 6 to 0. Later syncs start from the day of the last sample already read, the oldest across metrics.
7. Read sleep (`bc 27`), SpO2 (`bc 2a`) and temperature (`bc 25`).
8. Disconnect, always, also after an error.

Timeouts and retries:

- A request fails after 2 s without a notification on its channel. Every notification on that channel, long-channel fragments included, restarts the timer.
- Required requests (`01`, `16`, `03`, `43`, `15`, `bc 27`) are sent a second time after a timeout.
- Optional requests (`2c`, `36`, `38`, `3a`, `37`, `39`, `bc 2a`, `bc 25`) are not repeated. A missing reply is not an error: the sync goes on without that data.

## Captures and tools

Captures and HCI logs are never published. The tools in [`tools/`](../tools) work on local captures:

| Tool | Purpose |
|---|---|
| `ringtool.py` | Scans for the ring (`scan`), lists its services (`services`), sends commands and records frames (`capture`). |
| `btsnoop_to_capture.py` | Turns an Android HCI snoop log of the vendor app into a capture. |
| `checksum_check.py` | Tells which checksum, modulo 255 or modulo 256, fits the captured frames. |
| `capture_format.py` | The capture file format: read, write, checks. It rejects MAC addresses. |

Test fixtures are synthetic, or anonymized with MAC addresses and serial numbers removed. If you contribute a capture-based fix, share only synthetic or anonymized frames.

## Open questions

- **History retention**: the vendor app and RingLife request days 0 to 6. How many days the ring keeps is not measured.
- **Clock**: how fast the ring clock drifts, and whether it must be set at every connection, is not measured. Both apps set it every time.
- **Sleep stage codes**: `02` light, `03` deep, `04` REM, `05` awake is a hypothesis. It needs a comparison with the vendor app's hypnogram.
- **Battery level**: byte 1 of the `03` reply is read as a percentage, not yet compared with the vendor app.
- **Switch-off commands**: switching off SpO2, stress, HRV and temperature is derived by analogy, never captured.
- **HRV packet count**: the history header seen had `n` = 5, so four data frames with 52 bytes in all. At two bytes per slot, that holds 26 half-hour slots, not 48. How the ring reports a full day of HRV (more frames, or another interval) is not confirmed.
- **Unknown bytes**: byte 7 (`06`) of `01` and its reply `01 01 00 00 02`; bytes `0f 00 5f 01` of `43`; the last byte (`05`) of the `16` read reply; byte 3 of the `2c` read reply; the `0a 60` parameters of `38`; bytes 6–7 of `69` frames; the byte `25` of the temperature measurement start `69 0b 25`.
- **Long-channel setup messages**: the meaning of `bc 30`, `bc 4a` and `bc 41`.
- **`bc 26`**: acknowledgement or deletion. Never sent until this is known.
- **Real-time types**: the `69` types for SpO2, HRV and stress, and a command that measures temperature on demand.
- **Unsolicited events**: the meaning of the `73 12` fields is a hypothesis.
- **Past days of temperature**: whether a temperature request can return days before today.
- **Stress scale**: the range of the ring's stress values.
- **Device Information text**: the exact Firmware Revision string the R09 returns. RingLife extracts `n.nn.nn` from it.
- **Keep-alive**: the purpose of `48`.
- **Raw signal**: no command that returns the raw optical (PPG) signal has been found.
