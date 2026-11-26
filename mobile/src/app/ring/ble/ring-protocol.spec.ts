import { bytesToHex, buildFrame, hexToBytes } from './frame';
import {
  BigAccumulator,
  CHECKSUM,
  batteryFrame,
  hrHistoryFrame,
  hrSettingsWriteFrame,
  localMidnight,
  parseBattery,
  parseHrHistory,
  parseHrSettings,
  parseSleep,
  parseSpo2,
  parseStressHistory,
  parseHrvHistory,
  parseTemperature,
  bigFrame,
  parseWorkoutHeartRate,
  workoutFrame,
  crc16,
  spo2Request,
  temperatureRequest,
  parseSteps,
  spo2SettingsWriteFrame,
  hrvSettingsWriteFrame,
  temperatureSettingsWriteFrame,
  temperatureSettingsReadFrame,
  spo2SettingsReadFrame,
  stressSettingsReadFrame,
  hrvSettingsReadFrame,
  parseMeasureSwitch,
  stressSettingsWriteFrame,
  setTimeFrame,
  sleepRequest,
  stepsFrame,
  measureStartFrame,
  measureStopFrame,
  parseMeasure,
} from './ring-protocol';

// Ora di Roma d'inverno: +60. I pacchetti qui sotto sono sintetici, nel formato decodificato da catture vere.
const TZ = 60;
const NOW = Date.UTC(2026, 10, 16, 13, 25, 39); // 14:25:39 locali

describe('ring protocol', () => {
  it('builds the same packets the vendor app sends (verified on a capture)', () => {
    expect(bytesToHex(batteryFrame())).toBe('03000000000000000000000000000003');
    expect(bytesToHex(stepsFrame(0))).toBe('43000f005f01000000000000000000b2');
    expect(bytesToHex(stepsFrame(6))).toBe('43060f005f01000000000000000000b8');
    expect(bytesToHex(sleepRequest())).toBe('bc2702008180ff01');
  });

  it('sets the time as BCD in the phone local time', () => {
    // Stesso formato catturato: 01 26 11 16 14 25 39 06.
    expect(bytesToHex(setTimeFrame(new Date(NOW), TZ))).toBe('012611161425390600000000000000c6');
  });

  it('writes the heart-rate setting like the one tried on the ring', () => {
    expect(bytesToHex(hrSettingsWriteFrame(true, 5))).toBe('1602010500000000000000000000001e');
    expect(parseHrSettings(hexToBytes('1601010505').slice(1))).toEqual({ enabled: true, intervalMin: 5 });
    expect(parseHrSettings(hexToBytes('16010 21e05'.replace(' ', '')).slice(1))).toEqual({ enabled: false, intervalMin: 30 });
  });

  it('writes SpO2 and stress on like the vendor app does (verified on captures)', () => {
    expect(bytesToHex(spo2SettingsWriteFrame(true))).toBe('2c02010000000000000000000000002f');
    expect(bytesToHex(stressSettingsWriteFrame(true))).toBe('36020100000000000000000000000039');
  });

  it('writes HRV and temperature on like the vendor app does (verified on captures)', () => {
    expect(bytesToHex(hrvSettingsWriteFrame(true))).toBe('3802010a6000000000000000000000a5');
    expect(bytesToHex(temperatureSettingsWriteFrame(true))).toBe('3a030201000000000000000000000040');
  });

  it('reads which measures are on, with the readings of the captures (docs/adr/0049)', () => {
    expect(bytesToHex(spo2SettingsReadFrame()).slice(0, 4)).toBe('2c01');
    expect(bytesToHex(stressSettingsReadFrame()).slice(0, 4)).toBe('3601');
    expect(bytesToHex(hrvSettingsReadFrame()).slice(0, 4)).toBe('3801');
    expect(bytesToHex(temperatureSettingsReadFrame()).slice(0, 6)).toBe('3a0301');
    // `3a 03 01 00` da spenta, `36 01 01` acceso, `2c 01 01 00` acceso (docs/protocol.md).
    expect(parseMeasureSwitch(hexToBytes('030100'), [0x03, 0x01])).toBe(false);
    expect(parseMeasureSwitch(hexToBytes('030101'), [0x03, 0x01])).toBe(true);
    expect(parseMeasureSwitch(hexToBytes('0101'), [0x01])).toBe(true);
    expect(parseMeasureSwitch(hexToBytes('010100'), [0x01])).toBe(true);
    // La conferma di una scrittura (`3a 03 02 …`) non è una lettura.
    expect(parseMeasureSwitch(hexToBytes('030201'), [0x03, 0x01])).toBeNull();
  });

  it('asks for the heart rate of a day with the local midnight as little-endian seconds', () => {
    const midnight = localMidnight(NOW, TZ);
    const frame = hrHistoryFrame(midnight, TZ);
    const seconds = (midnight + TZ * 60000) / 1000;
    expect(frame[0]).toBe(0x15);
    expect(frame[1] | (frame[2] << 8) | (frame[3] << 16) | (frame[4] << 24)).toBe(seconds);
  });

  it('reads the battery', () => {
    expect(parseBattery(hexToBytes('6400').slice(0))).toEqual({ percent: 100, charging: false });
    expect(parseBattery(hexToBytes('3f01'))).toEqual({ percent: 63, charging: true });
  });

  describe('steps', () => {
    const header = buildFrame(0x43, [0xf0, 0x02, 0x01], CHECKSUM);
    // 13:00 (0x34 = 52 quarti): 141 passi; 19:00 (0x4c): 609 passi. Calorie e distanza sono inventate.
    const row = (quarter: number, index: number, steps: number) =>
      buildFrame(0x43, [0x26, 0x11, 0x15, quarter, index, 0x02, 0xc2, 0x01, steps & 0xff, steps >> 8, 0x6a, 0x00], CHECKSUM);

    it('gives the steps of the hour that ENDS at ts', () => {
      const samples = parseSteps([header, row(0x34, 0, 141), row(0x4c, 1, 609)], TZ);
      expect(samples).toEqual([
        { metric: 'STEPS', ts: Date.UTC(2026, 10, 15, 13, 0) , value: 141 },
        { metric: 'STEPS', ts: Date.UTC(2026, 10, 15, 19, 0) , value: 609 },
      ]);
    });

    it('ignores the empty-day answer and zero hours', () => {
      const empty = buildFrame(0x43, [0xff, 0x00, 0x00], CHECKSUM);
      expect(parseSteps([empty], TZ)).toEqual([]);
      expect(parseSteps([row(0x34, 0, 0)], TZ)).toEqual([]);
    });
  });

  describe('heart rate', () => {
    const midnightLocal = Date.UTC(2026, 10, 16) / 1000;
    const stamp = [midnightLocal & 0xff, (midnightLocal >>> 8) & 0xff, (midnightLocal >>> 16) & 0xff, (midnightLocal >>> 24) & 0xff];
    const zeros = (n: number) => new Array(n).fill(0);
    const packets = (values: Record<number, number>) => {
      // 24 pacchetti: intestazione, poi 9 valori e 13 per pacchetto, come l'anello.
      const all: number[] = zeros(9 + 22 * 13);
      for (const [slot, value] of Object.entries(values)) {
        all[Number(slot)] = value;
      }
      const frames = [buildFrame(0x15, [0x00, 24, 5], CHECKSUM), buildFrame(0x15, [0x01, ...stamp, ...all.slice(0, 9)], CHECKSUM)];
      for (let i = 2; i < 24; i++) {
        const from = 9 + (i - 2) * 13;
        frames.push(buildFrame(0x15, [i, ...all.slice(from, from + 13)], CHECKSUM));
      }
      return frames;
    };

    it('puts each value at slot × interval minutes after the local midnight', () => {
      // Slot 177 = 14:45, 178 = 14:50, 180 = 15:00: come nella prova sull'anello.
      const samples = parseHrHistory(packets({ 177: 83, 178: 89, 180: 85 }), TZ);
      const at = (h: number, m: number) => Date.UTC(2026, 10, 16, h - 1, m);
      expect(samples).toEqual([
        { metric: 'HR', ts: at(14, 45), value: 83 },
        { metric: 'HR', ts: at(14, 50), value: 89 },
        { metric: 'HR', ts: at(15, 0), value: 85 },
      ]);
    });

    it('returns nothing when a packet is missing instead of shifting the times', () => {
      const frames = packets({ 177: 83 });
      expect(parseHrHistory(frames.filter((f) => f[1] !== 10), TZ)).toEqual([]);
    });

    it('returns nothing for the empty-day answer', () => {
      expect(parseHrHistory([buildFrame(0x15, [0xff], CHECKSUM)], TZ)).toEqual([]);
    });
  });

  describe('sleep', () => {
    // Notte inventata: 23:00-06:00 = 420 minuti: leggero 120, profondo 60, REM 60, sveglio 10, leggero 120, REM 50.
    const data = Uint8Array.from([0x01, 0x00, 0x10, 0x64, 0x05, 0x68, 0x01, 2, 0x78, 3, 0x3c, 4, 0x3c, 5, 0x0a, 2, 0x78, 4, 0x32]);

    it('reads stages and puts the start on the evening before when it is after the end', () => {
      const sessions = parseSleep(data, NOW, TZ);
      expect(sessions).toHaveLength(1);
      const day = localMidnight(NOW, TZ);
      expect(sessions[0].start).toBe(day - 60 * 60000);
      expect(sessions[0].end).toBe(day + 360 * 60000);
      expect(sessions[0].stages.map((s) => [s.stage, (s.end - s.start) / 60000])).toEqual([
        ['light', 120],
        ['deep', 60],
        ['rem', 60],
        ['awake', 10],
        ['light', 120],
        ['rem', 50],
      ]);
    });

    it('discards a night whose stages do not add up to the end', () => {
      const broken = Uint8Array.from(data);
      broken[18] = 0x30; // l'ultimo tratto dura 48 minuti, non 50
      expect(parseSleep(broken, NOW, TZ)).toEqual([]);
    });

    it('discards an unknown stage code', () => {
      const unknown = Uint8Array.from(data);
      unknown[7] = 9;
      expect(parseSleep(unknown, NOW, TZ)).toEqual([]);
    });
  });

  describe('long channel', () => {
    it('waits for the whole message across notifications', () => {
      const acc = new BigAccumulator();
      const message = Uint8Array.from([0xbc, 0x27, 0x03, 0x00, 0xaa, 0xbb, 1, 2, 3]);
      expect(acc.push(message.slice(0, 5))).toBeNull();
      expect(acc.push(message.slice(5, 8))).toBeNull();
      expect(acc.push(message.slice(8))).toEqual({ command: 0x27, data: Uint8Array.from([1, 2, 3]) });
    });

    it('answers the bare acknowledgement with empty data', () => {
      const acc = new BigAccumulator();
      expect(acc.push(hexToBytes('bc2a0000ffff'))).toEqual({ command: 0x2a, data: new Uint8Array(0) });
    });

    it('drops leftovers that do not start a message', () => {
      const acc = new BigAccumulator();
      expect(acc.push(Uint8Array.from([1, 2, 3]))).toBeNull();
      expect(acc.push(hexToBytes('bc2a0000ffff'))).toEqual({ command: 0x2a, data: new Uint8Array(0) });
    });

    it('forgets half a message on reset', () => {
      const acc = new BigAccumulator();
      expect(acc.push(Uint8Array.from([0xbc, 0x27, 200, 0, 0, 0, 1]))).toBeNull();
      acc.reset();
      expect(acc.push(hexToBytes('bc2a0000ffff'))).toEqual({ command: 0x2a, data: new Uint8Array(0) });
    });
  });

  describe('long channel framing', () => {
    it('computes the CRC-16/MODBUS the vendor app writes (checked on real requests)', () => {
      const le = (v: number) => bytesToHex(Uint8Array.from([v & 255, v >> 8]));
      expect(le(crc16([]))).toBe('ffff');
      expect(le(crc16([0x00]))).toBe('bf40');
      expect(le(crc16([0x06]))).toBe('3f42');
      expect(le(crc16([0xff]))).toBe('ff00');
      expect(le(crc16([0x00, 0x01]))).toBe('c070');
      expect(le(crc16([0xff, 0x01]))).toBe('8180');
    });

    it('builds the same requests the vendor app sends', () => {
      expect(bytesToHex(bigFrame(0x30))).toBe('bc300000ffff');
      expect(bytesToHex(spo2Request())).toBe('bc2a0100ff00ff');
      expect(bytesToHex(temperatureRequest())).toBe('bc2501003f4206');
      expect(bytesToHex(sleepRequest())).toBe('bc2702008180ff01');
    });
  });

  describe('stress and HRV history', () => {
    const midnight = Date.UTC(2026, 10, 16) - TZ * 60000;
    const header = (op: number) => buildFrame(op, [0x00, 5, 30], CHECKSUM);
    const packets = (op: number, bytes: number[]) => [
      header(op),
      ...[0, 1, 2, 3].map((i) => buildFrame(op, [i + 1, ...bytes.slice(i * 13, i * 13 + 13)], CHECKSUM)),
    ];

    it('reads one byte per 30-minute slot from midnight, 0 meaning no measurement', () => {
      const bytes = new Array(52).fill(0);
      bytes[2] = 43; // 01:00
      bytes[14] = 38; // 07:00, nel secondo pacchetto
      expect(parseStressHistory(packets(0x37, bytes), midnight)).toEqual([
        { metric: 'STRESS', ts: midnight + 60 * 60000, value: 43 },
        { metric: 'STRESS', ts: midnight + 7 * 3600000, value: 38 },
      ]);
    });

    it('reads HRV as 16-bit big-endian values, also across a packet boundary', () => {
      const bytes = new Array(52).fill(0);
      // Valore 46 allo slot 6: i suoi due byte sono l'ultimo del primo pacchetto (indice 12) e il primo del secondo (13).
      bytes[12] = 0;
      bytes[13] = 46;
      // Valore 300 (0x012c) allo slot 3: byte 6 e 7.
      bytes[6] = 0x01;
      bytes[7] = 0x2c;
      expect(parseHrvHistory(packets(0x39, bytes), midnight)).toEqual([
        { metric: 'HRV', ts: midnight + 3 * 1800000, value: 300 },
        { metric: 'HRV', ts: midnight + 6 * 1800000, value: 46 },
      ]);
    });

    it('returns nothing for the empty-day answer or a missing packet', () => {
      expect(parseStressHistory([buildFrame(0x37, [0xff], CHECKSUM)], midnight)).toEqual([]);
      expect(parseHrvHistory(packets(0x39, new Array(52).fill(1)).filter((f) => f[1] !== 2), midnight)).toEqual([]);
    });
  });

  describe('SpO2 and temperature on the long channel', () => {
    it('reads hourly min-max pairs of SpO2 for each day', () => {
      const pairs = new Array(48).fill(0);
      pairs[0] = 96;
      pairs[1] = 96; // 00:xx: uguali, comunque due campioni
      pairs[18] = 94;
      pairs[19] = 98; // 09:xx
      const data = Uint8Array.from([0, ...pairs]);
      const samples = parseSpo2(data, NOW, TZ);
      const day = localMidnight(NOW, TZ);
      expect(samples).toEqual([
        { metric: 'SPO2', ts: day + 15 * 60000, value: 96 },
        { metric: 'SPO2', ts: day + 45 * 60000, value: 96 },
        { metric: 'SPO2', ts: day + 9 * 3600000 + 15 * 60000, value: 94 },
        { metric: 'SPO2', ts: day + 9 * 3600000 + 45 * 60000, value: 98 },
      ]);
    });

    it('puts an older day (days ago = 1) on the day before', () => {
      const pairs = new Array(48).fill(0);
      pairs[0] = 97;
      pairs[1] = 97;
      const samples = parseSpo2(Uint8Array.from([1, ...pairs]), NOW, TZ);
      expect(samples[0].ts).toBe(localMidnight(NOW, TZ) - 86_400_000 + 15 * 60000);
    });

    it('converts temperature from tenths of a degree above 20 (162 = 36.2)', () => {
      const values = new Array(48).fill(0);
      values[3] = 162;
      values[40] = 169;
      const samples = parseTemperature(Uint8Array.from([0, 30, ...values]), NOW, TZ);
      const day = localMidnight(NOW, TZ);
      expect(samples).toEqual([
        { metric: 'TEMP', ts: day + 3 * 1800000, value: 36.2 },
        { metric: 'TEMP', ts: day + 40 * 1800000, value: 36.9 },
      ]);
    });

    it('gives nothing for an empty answer', () => {
      expect(parseSpo2(new Uint8Array(0), NOW, TZ)).toEqual([]);
      expect(parseTemperature(new Uint8Array(0), NOW, TZ)).toEqual([]);
    });
  });

  describe('live heart rate (workout)', () => {
    it('builds the workout frames the vendor app sends', () => {
      expect(bytesToHex(workoutFrame(1))).toBe('7701040000000000000000000000007c');
      expect(bytesToHex(workoutFrame(3))).toBe('7703040000000000000000000000007e');
      expect(bytesToHex(workoutFrame(2))).toBe('7702040000000000000000000000007d');
      expect(bytesToHex(workoutFrame(4))).toBe('7704040000000000000000000000007f');
    });

    it('reads the heart rate of every second, and ignores other packets', () => {
      expect(parseWorkoutHeartRate(hexToBytes('78040100005a000000000000000000d7'))).toBe(90);
      expect(parseWorkoutHeartRate(hexToBytes('78040200d662000000000000000000b6'))).toBe(98);
      expect(parseWorkoutHeartRate(buildFrame(0x78, [4, 1, 0, 5, 0], CHECKSUM))).toBeNull();
      expect(parseWorkoutHeartRate(hexToBytes('770100dedbfb6a000000000000000096'))).toBeUndefined();
    });
  });

  describe('measures on demand', () => {
    it('builds the start and stop frames the vendor app sends (verified on captures)', () => {
      expect(bytesToHex(measureStartFrame('temperature'))).toBe('690b2500000000000000000000000099');
      expect(bytesToHex(measureStopFrame('temperature', 0xa6))).toBe('6a0b0000000000000000000000000075');
      expect(bytesToHex(measureStartFrame('spo2'))).toBe('69032500000000000000000000000091');
      expect(bytesToHex(measureStopFrame('spo2', 0x61))).toBe('6a03000000000000000000000000006d');
      expect(bytesToHex(measureStartFrame('stress'))).toBe('69082500000000000000000000000096');
      expect(bytesToHex(measureStopFrame('stress', 0x20))).toBe('6a080000000000000000000000000072');
      expect(bytesToHex(measureStartFrame('hrv'))).toBe('690a2500000000000000000000000098');
      expect(bytesToHex(measureStartFrame('heartRate'))).toBe('6901000000000000000000000000006a');
    });

    it('puts the last value in the stop frame for heart rate and HRV, like the vendor app', () => {
      // Valori sintetici.
      expect(bytesToHex(measureStopFrame('hrv', 0x30))).toBe('6a0a30000000000000000000000000a4');
      expect(bytesToHex(measureStopFrame('heartRate', 0x48))).toBe('6a0148000000000000000000000000b3');
    });

    it('reads the value of each measure, null while the ring is still measuring', () => {
      // Sintetici; i byte 6-7 cambiano a ogni pacchetto e non contano.
      expect(parseMeasure(buildFrame(0x69, [0x0b, 0, 0, 0, 0, 0x80, 0x02, 0x02], CHECKSUM), 'temperature')).toEqual({ error: 0, raw: 0, value: null });
      expect(parseMeasure(buildFrame(0x69, [0x0b, 0, 0xa6, 0, 0, 0x9c, 0x02, 0x02], CHECKSUM), 'temperature')).toEqual({ error: 0, raw: 0xa6, value: 36.6 });
      expect(parseMeasure(buildFrame(0x69, [0x03, 0, 0x61, 0x01], CHECKSUM), 'spo2')).toEqual({ error: 0, raw: 0x61, value: 97 });
      expect(parseMeasure(buildFrame(0x69, [0x0a, 0, 0x34, 0, 0, 0xb0, 0x02], CHECKSUM), 'hrv')).toEqual({ error: 0, raw: 0x34, value: 52 });
      expect(parseMeasure(buildFrame(0x69, [0x08, 0, 0x20, 0, 0, 0xc2, 0x02], CHECKSUM), 'stress')).toEqual({ error: 0, raw: 0x20, value: 32 });
      expect(parseMeasure(buildFrame(0x69, [0x01, 0, 0x48], CHECKSUM), 'heartRate')).toEqual({ error: 0, raw: 0x48, value: 72 });
      expect(parseMeasure(buildFrame(0x69, [0x0b, 2, 0], CHECKSUM), 'temperature')).toEqual({ error: 2, raw: 0, value: null });
    });

    it('ignores the packets of another measure and other packets', () => {
      expect(parseMeasure(buildFrame(0x69, [0x01, 0, 0x48], CHECKSUM), 'temperature')).toBeUndefined();
      expect(parseMeasure(buildFrame(0x6a, [0x0b, 0xa6], CHECKSUM), 'temperature')).toBeUndefined();
      expect(parseMeasure(new Uint8Array([0x69, 0x0b, 0, 0xa6]), 'temperature')).toBeUndefined();
    });
  });
});
