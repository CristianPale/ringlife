import { buildFrame, bytesToHex } from './frame';
import { BleRingSource } from './ble-ring-source';
import { RingChannel, RingLink } from './ring-link';
import { CHECKSUM, localMidnight } from './ring-protocol';

const TZ = 60;
const NOW = new Date(Date.UTC(2026, 10, 16, 13, 25, 39)); // 14:25 locali

/** Un anello finto: a ogni richiesta risponde con i pacchetti che gli si danno, subito. */
class FakeLink extends RingLink {
  requests: string[] = [];
  connected = false;
  silent = false;
  /** Opcode ai quali questo anello finto non risponde. */
  silentOpcodes = new Set<number>();
  /** Opcode ai quali non risponde la prima volta (un pacchetto perso). */
  silentOnce = new Set<number>();
  /** Pausa tra un pacchetto e l'altro della risposta, ms: un collegamento lento. 0 = subito. */
  gapMs = 0;
  /** I valori dei pacchetti della misura a comando (`69 <tipo>`), per tipo e in ordine; 0 = sta ancora misurando. */
  measures: Record<number, number[]> = { 0x0b: [0, 0, 0, 0xa6, 0xa6, 0xa6] };
  /** Il byte d'errore di quei pacchetti. */
  measureError = 0;
  private notify: (channel: RingChannel, data: Uint8Array) => void = () => undefined;
  private lost: (() => void) | undefined;

  constructor(private readonly answers: (channel: RingChannel, request: Uint8Array) => Uint8Array[]) {
    super();
  }

  async connect(onNotify: (channel: RingChannel, data: Uint8Array) => void, onLost?: () => void): Promise<void> {
    this.connected = true;
    this.notify = onNotify;
    this.lost = onLost;
  }
  async send(channel: RingChannel, data: Uint8Array): Promise<void> {
    this.requests.push(bytesToHex(data));
    if (this.silent) {
      return;
    }
    if (channel === 'command' && this.silentOnce.delete(data[0])) {
      return;
    }
    this.answers(channel, data).forEach((reply, i) => {
      if (this.gapMs > 0) {
        setTimeout(() => this.notify(channel, reply), (i + 1) * this.gapMs);
      } else {
        queueMicrotask(() => this.notify(channel, reply));
      }
    });
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** Una notifica spontanea dell'anello, come il battito dal vivo. */
  push(data: Uint8Array, channel: RingChannel = 'command'): void {
    this.notify(channel, data);
  }

  /** L'anello si scollega da solo. */
  lose(): void {
    this.connected = false;
    this.lost?.();
  }
}

const f = (opcode: number, payload: number[]) => buildFrame(opcode, payload, CHECKSUM);

function ring(): FakeLink {
  const today = localMidnight(NOW.getTime(), TZ);
  const link: FakeLink = new FakeLink((channel, request) => {
    if (channel === 'big') {
      const reply = (command: number, data: number[]) => Uint8Array.from([0xbc, command, data.length & 255, data.length >> 8, 0, 0, ...data]);
      if (request[1] === 0x2a) {
        // Un solo giorno (oggi): 24 coppie minimo-massimo; la 8ª ora (08:xx) vale 95-97, le altre nessuna misura.
        const pairs = new Array(48).fill(0);
        pairs[16] = 95;
        pairs[17] = 97;
        return [reply(0x2a, [0, ...pairs])];
      }
      if (request[1] === 0x25) {
        // Un giorno: intervallo 30 minuti, 48 valori; lo slot 17 (08:30) è 36,4 °C = 20 + 164/10.
        const values = new Array(48).fill(0);
        values[17] = 164;
        return [reply(0x25, [0, 30, ...values])];
      }
      // Conferma, poi la notte: 23:00-06:00 inventata.
      const sleep = [1, 0, 0x10, 0x64, 0x05, 0x68, 0x01, 2, 0x78, 3, 0x3c, 4, 0x3c, 5, 0x0a, 2, 0x78, 4, 0x32];
      return [Uint8Array.from([0xbc, 0x3e, 1, 0, 0xbf, 0x40, 0]), Uint8Array.from([0xbc, 0x27, sleep.length, 0, 0xc3, 0x8e, ...sleep])];
    }
    switch (request[0]) {
      case 0x01:
        return [f(0x01, [1])];
      case 0x16:
        return [f(0x16, [2, 1, 0])];
      case 0x2c:
        return link.silentOpcodes.has(0x2c) ? [] : [f(0x2c, [2, 1])];
      case 0x36:
        return link.silentOpcodes.has(0x36) ? [] : [f(0x36, [2, 1])];
      case 0x37:
      case 0x39: {
        if (request[1] !== 0) {
          return [f(request[0], [0xff])];
        }
        // Oggi: un valore alle 08:30 (slot 17). Stress 1 byte; HRV 2 byte big-endian (52 ms).
        const frames = [f(request[0], [0, 5, 30])];
        const bytes = new Array(52).fill(0);
        if (request[0] === 0x37) {
          bytes[17] = 40;
        } else {
          bytes[34] = 0;
          bytes[35] = 52;
        }
        for (let i = 0; i < 4; i++) {
          frames.push(f(request[0], [i + 1, ...bytes.slice(i * 13, i * 13 + 13)]));
        }
        return frames;
      }
      case 0x38:
        return link.silentOpcodes.has(0x38) ? [] : [f(0x38, [2, 1])];
      case 0x3a:
        return link.silentOpcodes.has(0x3a) ? [] : [f(0x3a, [3, 2, 1])];
      case 0x03:
        return [f(0x03, [63, 0])];
      case 0x69:
        // Valori sintetici; i byte 6-7 cambiano a ogni pacchetto come nelle catture.
        return (link.measures[request[1]] ?? []).map((v, i) => f(0x69, [request[1], link.measureError, v, 0, 0, (0x80 + i) & 0xff, 0x02, 0x02]));
      case 0x6a:
        return [f(0x6a, [request[1], 0])];
      case 0x43: {
        // Solo ieri (giorno 1) ha dati: due ore. Il giorno 0 ha l'ora in corso (14:00, 82 passi). Il resto è vuoto.
        if (request[1] === 1) {
          return [f(0x43, [0xf0, 2, 1]), f(0x43, [0x26, 0x11, 0x15, 0x34, 0, 2, 0xc2, 1, 141, 0, 0x6a, 0]), f(0x43, [0x26, 0x11, 0x15, 0x4c, 1, 2, 0x28, 7, 0x61, 2, 0xb3, 1])];
        }
        if (request[1] === 0) {
          return [f(0x43, [0xf0, 1, 1]), f(0x43, [0x26, 0x11, 0x16, 0x38, 0, 1, 0xe5, 0, 82, 0, 0x36, 0])];
        }
        return [f(0x43, [0xff, 0, 0])];
      }
      case 0x15: {
        const requested = (request[1] | (request[2] << 8) | (request[3] << 16) | (request[4] << 24)) >>> 0;
        const todayLocal = (today + TZ * 60000) / 1000;
        if (requested !== todayLocal) {
          return [f(0x15, [0xff])];
        }
        const stamp = [requested & 0xff, (requested >>> 8) & 0xff, (requested >>> 16) & 0xff, (requested >>> 24) & 0xff];
        const values = new Array(9 + 22 * 13).fill(0);
        values[100] = 83; // slot 100 = 08:20 locali, prima di «adesso»
        const frames = [f(0x15, [0, 24, 5]), f(0x15, [1, ...stamp, ...values.slice(0, 9)])];
        for (let i = 2; i < 24; i++) {
          frames.push(f(0x15, [i, ...values.slice(9 + (i - 2) * 13, 9 + (i - 1) * 13)]));
        }
        return frames;
      }
      default:
        return [];
    }
  });
  return link;
}

import { describeRingError } from '../ring-source';

describe('BleRingSource', () => {
  it('runs the whole reading and returns samples and the night', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.setTime(NOW, TZ);
    expect(await source.battery()).toEqual({ percent: 63, charging: false });
    const reading = await source.readHistory(null);

    const steps = reading.samples.filter((s) => s.metric === 'STEPS');
    // L'ora delle 14 non è finita: i suoi passi non si inviano ancora.
    expect(steps.map((s) => s.value)).toEqual([141, 609]);
    expect(reading.samples.filter((s) => s.metric === 'HR')).toEqual([{ metric: 'HR', ts: localMidnight(NOW.getTime(), TZ) + 100 * 5 * 60000, value: 83 }]);
    const at = (metric: string) => reading.samples.filter((s) => s.metric === metric);
    const localDay = localMidnight(NOW.getTime(), TZ);
    expect(at('STRESS')).toEqual([{ metric: 'STRESS', ts: localDay + 17 * 30 * 60000, value: 40 }]);
    expect(at('HRV')).toEqual([{ metric: 'HRV', ts: localDay + 17 * 30 * 60000, value: 52 }]);
    expect(at('SPO2').map((s) => s.value)).toEqual([95, 97]);
    expect(at('TEMP')).toEqual([{ metric: 'TEMP', ts: localDay + 17 * 30 * 60000, value: 36.4 }]);
    expect(reading.sessions).toHaveLength(1);
    expect(reading.sessions[0].stages).toHaveLength(6);
    await source.disconnect();
    expect(link.connected).toBe(false);
  });

  it('asks only for the days since the last reading', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.setTime(NOW, TZ);
    await source.readHistory(localMidnight(NOW.getTime(), TZ) + 3_600_000);
    const stepRequests = link.requests.filter((r) => r.startsWith('43'));
    expect(stepRequests).toHaveLength(1);
    expect(stepRequests[0].startsWith('4300')).toBe(true);
  });

  it('gives back the nights the ring has even when they end before the last reading', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.setTime(NOW, TZ);
    // L'ultima lettura è dopo il risveglio: la notte serve lo stesso, la coda decide se è nuova o più lunga.
    const reading = await source.readHistory(NOW.getTime() - 60_000);
    expect(reading.sessions).toHaveLength(1);
  });

  it('reads all 7 days on the first reading', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.setTime(NOW, TZ);
    await source.readHistory(null);
    expect(link.requests.filter((r) => r.startsWith('43'))).toHaveLength(7);
  });

  it('turns the heart-rate measure on or off', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.applySettings({ hrIntervalMin: 5, stress: false, spo2: false, hrv: false, temperature: false });
    await source.applySettings({ hrIntervalMin: 0, stress: false, spo2: false, hrv: false, temperature: false });
    expect(link.requests[0]).toBe('1602010500000000000000000000001e');
    expect(link.requests[5].startsWith('160202' + '1e')).toBe(true);
  });

  it('writes SpO2, stress, HRV and temperature along with the heart rate', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    await source.applySettings({ hrIntervalMin: 5, stress: true, spo2: true, hrv: true, temperature: true });
    expect(link.requests.map((r) => r.slice(0, 8))).toEqual(['16020105', '2c020100', '36020100', '3802010a', '3a030201']);
    await source.applySettings({ hrIntervalMin: 5, stress: false, spo2: false, hrv: false, temperature: false });
    expect(link.requests.slice(-4).map((r) => r.slice(0, 8))).toEqual(['2c020000', '36020000', '3802000a', '3a030200']);
  });

  it('does not fail the reading when the ring does not answer the SpO2, stress, HRV or temperature write', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      link.silentOpcodes = new Set([0x2c, 0x36, 0x38, 0x3a]);
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      const done = source.applySettings({ hrIntervalMin: 5, stress: true, spo2: true, hrv: true, temperature: true });
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a connection timeout when the ring does not answer, after asking twice', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      link.silent = true;
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      const result = source.battery().catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(4_100);
      expect(await result).toMatchObject({ code: 'connection_timeout', message: 'nessuna risposta al comando 03' });
      expect(link.requests.filter((r) => r.startsWith('03'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says whether the ring is on the charger', async () => {
    const link = new FakeLink((_channel, request) => (request[0] === 0x03 ? [f(0x03, [64, 1])] : []));
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    expect(await source.battery()).toEqual({ percent: 64, charging: true });
  });

  it('asks a needed request again when the first answer is lost', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      link.silentOnce.add(0x03);
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      const result = source.battery();
      await vi.advanceTimersByTimeAsync(2_100);
      expect(await result).toEqual({ percent: 63, charging: false });
      expect(link.requests.filter((r) => r.startsWith('03'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not ask an optional request twice', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      link.silentOpcodes = new Set([0x2c]);
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      const done = source.applySettings({ hrIntervalMin: 5, stress: false, spo2: true, hrv: false, temperature: false });
      await vi.advanceTimersByTimeAsync(12_000);
      await done;
      expect(link.requests.filter((r) => r.startsWith('2c'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting while a long answer is still arriving on a slow link', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      await source.setTime(NOW, TZ);
      // 25 pacchetti del battito, uno ogni 300 ms: 7,5 s in tutto, mai 2 s di silenzio.
      link.gapMs = 300;
      const reading = source.readHistory(localMidnight(NOW.getTime(), TZ) + 3_600_000);
      await vi.advanceTimersByTimeAsync(60_000);
      const { samples } = await reading;
      expect(samples.filter((s) => s.metric === 'HR').map((s) => s.value)).toEqual([83]);
      expect(link.requests.filter((r) => r.startsWith('15'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops at once when the ring disconnects', async () => {
    vi.useFakeTimers();
    try {
      const link = ring();
      link.silent = true;
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      const result = source.battery().catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(100);
      link.lose();
      await vi.advanceTimersByTimeAsync(0);
      expect(await result).toMatchObject({ code: 'disconnected', message: 'scollegato durante il comando 03' });
      expect(link.requests.filter((r) => r.startsWith('03'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not spoiled by half a long-channel message left by an earlier reading', async () => {
    const link = ring();
    const source = new BleRingSource(link, () => NOW);
    await source.connect();
    // Un messaggio del sonno interrotto: testa che annuncia 200 byte, poi più niente.
    link.push(Uint8Array.from([0xbc, 0x27, 200, 0, 0, 0, 1, 2, 3]), 'big');
    await source.setTime(NOW, TZ);
    const reading = await source.readHistory(null);
    expect(reading.sessions).toHaveLength(1);
  });

  it('says in the message which command got no answer', async () => {
    const { RingError } = await import('../ring-source');
    expect(describeRingError(new RingError('connection_timeout', 'nessuna risposta al comando 43'))).toContain('(nessuna risposta al comando 43)');
    expect(describeRingError(new RingError('bluetooth_off'))).not.toContain('(');
  });

  describe('measures on demand', () => {
    it('starts the measure like the vendor app, waits for a steady value, then stops it', async () => {
      const link = ring();
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      expect(await source.measure('temperature')).toBe(36.6);
      expect(link.requests).toEqual(['690b2500000000000000000000000099', '6a0b0000000000000000000000000075']);
    });

    it('takes the middle value when the value moves at every packet', async () => {
      const link = ring();
      // Sintetici, come nella cattura: ossigeno che alterna, stress che cambia a ogni pacchetto.
      link.measures[0x03] = [0, 0, 0x61, 0x61, 0x5f, 0x5f, 0x61, 0x61, 0x5f];
      link.measures[0x08] = [0, 0, 0x24, 0x1d, 0x20, 0x1e, 0x1e, 0x2b, 0x21, 0x1e, 0x21, 0x1a];
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      expect(await source.measure('spo2')).toBe(97);
      // I primi nove: 36, 29, 32, 30, 30, 43, 33, 30, 33 → in ordine il quinto è 32.
      expect(await source.measure('stress')).toBe(32);
      expect(link.requests.filter((r) => r.startsWith('6a'))).toEqual(['6a03000000000000000000000000006d', '6a080000000000000000000000000072']);
    });

    it('stops HRV at its first value and puts it in the stop frame, like the vendor app', async () => {
      const link = ring();
      link.measures[0x0a] = [0, 0, 0, 0x30, 0, 0];
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      expect(await source.measure('hrv')).toBe(48);
      expect(link.requests).toEqual(['690a2500000000000000000000000098', '6a0a30000000000000000000000000a4']);
    });

    it('fails, and still stops the measure, when the ring reports an error', async () => {
      const link = ring();
      link.measureError = 1;
      const source = new BleRingSource(link, () => NOW);
      await source.connect();
      await expect(source.measure('temperature')).rejects.toMatchObject({ code: 'measure_failed', message: 'errore 01 dalla misura' });
      expect(link.requests.at(-1)).toBe('6a0b0000000000000000000000000075');
    });

    it('fails when the ring stops sending packets without a value', async () => {
      vi.useFakeTimers();
      try {
        const link = ring();
        link.measures[0x0b] = [0, 0, 0];
        const source = new BleRingSource(link, () => NOW);
        await source.connect();
        const result = source.measure('temperature').catch((e: Error) => e);
        await vi.advanceTimersByTimeAsync(4_100);
        expect(await result).toMatchObject({ code: 'measure_failed' });
        expect(link.requests.at(-1)).toBe('6a0b0000000000000000000000000075');
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives up after a minute without a value', async () => {
      const link = ring();
      link.measures[0x0b] = new Array(200).fill(0);
      let clock = NOW.getTime();
      // Ogni pacchetto è mezzo secondo dopo il precedente.
      const source = new BleRingSource(link, () => new Date((clock += 500)));
      await source.connect();
      await expect(source.measure('temperature')).rejects.toMatchObject({ code: 'measure_failed' });
      expect(link.requests.at(-1)).toBe('6a0b0000000000000000000000000075');
    });
  });

  describe('live heart rate', () => {
    it('starts a workout like the vendor app, passes the values on, and on stop pauses, ends and disconnects', async () => {
      const link = ring();
      const source = new BleRingSource(link, () => NOW);
      const values: (number | null)[] = [];
      const session = await source.startLiveHeartRate((v) => values.push(v));
      expect(link.requests.slice(-2).map((r) => r.slice(0, 6))).toEqual(['770104', '770304']);
      link.push(f(0x78, [4, 1, 0, 0, 0]));
      link.push(f(0x78, [4, 1, 0, 1, 64]));
      expect(values).toEqual([null, 64]);
      await session.stop();
      expect(link.requests.slice(-2).map((r) => r.slice(0, 6))).toEqual(['770204', '770404']);
      expect(link.connected).toBe(false);
    });

    it('pauses and resumes the workout, and in pause does not ask to resume after a silence', async () => {
      vi.useFakeTimers();
      try {
        const link = ring();
        const source = new BleRingSource(link, () => NOW);
        const session = await source.startLiveHeartRate(() => undefined);
        const sent = (prefix: string) => link.requests.filter((r) => r.startsWith(prefix)).length;
        await session.pause!();
        expect(link.requests.at(-1)?.slice(0, 6)).toBe('770204');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(sent('770304')).toBe(1);
        await session.resume!();
        expect(link.requests.at(-1)?.slice(0, 6)).toBe('770304');
        expect(sent('770304')).toBe(2);
        await session.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks to resume after a silence', async () => {
      vi.useFakeTimers();
      try {
        const link = ring();
        const source = new BleRingSource(link, () => NOW);
        const session = await source.startLiveHeartRate(() => undefined);
        const resumes = () => link.requests.filter((r) => r.startsWith('770304')).length;
        expect(resumes()).toBe(1);
        await vi.advanceTimersByTimeAsync(4_500);
        expect(resumes()).toBe(2);
        await session.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
