import { BleDevice, ScanResult } from '@capacitor-community/bluetooth-le';
import { RingError } from '../ring-source';
import {
  BleApi,
  CALL_TIMEOUT_MS,
  CHOOSE_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  CapacitorRingLink,
  RingCandidate,
  RingChooser,
  RingIdStore,
  SCAN_MS,
  SETTLE_MS,
} from './capacitor-ring-link';

const COMMAND_SERVICE = '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e';
const BIG_SERVICE = 'de5bf728-d711-4e47-af26-65e3012a5dc7';
const RING: BleDevice = { deviceId: 'ring-1', name: 'COLMI Ring 2' };

type ConnectOptions = Parameters<BleApi['connect']>[2];

/** Il plugin finto: risponde come gli si dice e ricorda le chiamate in ordine. */
class FakeBle implements BleApi {
  calls: string[] = [];
  enabled = true;
  /** Collegati al sistema, per i servizi dell'anello (su Android: tutti i dispositivi collegati). */
  attached: BleDevice[] = [];
  /** Collegati al sistema, per i servizi standard. */
  attachedGeneric: BleDevice[] = [];
  /** Gli identificativi che il sistema conosce (`getDevices`). */
  known = new Set<string>();
  /** Quelli che una ricerca sente, con la forza del segnale. */
  advertising: (BleDevice & { rssi?: number; at?: number })[] = [];
  /** Quelli a cui ci si collega. */
  reachable = new Set<string>();
  connectError: Error = new Error('Connection timeout.');
  hangConnect = false;
  options: ConnectOptions;
  readonly onDisconnect = new Map<string, (id: string) => void>();

  async initialize(): Promise<void> {
    this.calls.push('initialize');
  }
  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }
  async getDevices(ids: string[]): Promise<BleDevice[]> {
    this.calls.push(`getDevices ${ids.join(',')}`);
    return ids.filter((id) => this.known.has(id)).map((deviceId) => ({ deviceId }));
  }
  async getConnectedDevices(services: string[]): Promise<BleDevice[]> {
    const own = services.includes(COMMAND_SERVICE);
    this.calls.push(own ? 'attached' : 'attachedGeneric');
    return own ? this.attached : this.attachedGeneric;
  }
  async requestLEScan(_options: unknown, callback: (result: ScanResult) => void): Promise<void> {
    this.calls.push('scan');
    for (const { rssi, at, ...device } of this.advertising) {
      const result = { device, rssi } as ScanResult;
      if (at) {
        setTimeout(() => callback(result), at);
      } else {
        queueMicrotask(() => callback(result));
      }
    }
  }
  async stopLEScan(): Promise<void> {
    this.calls.push('stopScan');
  }
  connect(id: string, onDisconnect?: (id: string) => void, options?: ConnectOptions): Promise<void> {
    this.calls.push(`connect ${id}`);
    this.options = options;
    if (this.hangConnect) {
      return new Promise(() => undefined);
    }
    if (!this.reachable.has(id)) {
      return Promise.reject(this.connectError);
    }
    if (onDisconnect) {
      this.onDisconnect.set(id, onDisconnect);
    }
    return Promise.resolve();
  }
  async disconnect(id: string): Promise<void> {
    this.calls.push(`disconnect ${id}`);
  }
  async startNotifications(_id: string, service: string): Promise<void> {
    this.calls.push(`notify ${service === COMMAND_SERVICE ? 'command' : service === BIG_SERVICE ? 'big' : service}`);
  }
  async writeWithoutResponse(id: string): Promise<void> {
    this.calls.push(`write ${id}`);
  }
  /** Testi di Device Information per caratteristica (`2a26` firmware, `2a27` hardware). Assente = la lettura fallisce. */
  deviceInfo = new Map<string, string>();
  async read(_id: string, _service: string, characteristic: string): Promise<DataView> {
    const short = characteristic.slice(4, 8);
    this.calls.push(`read ${short}`);
    const text = this.deviceInfo.get(short);
    if (text === undefined) {
      throw new Error('Characteristic not found');
    }
    return new DataView(new TextEncoder().encode(text).buffer);
  }
}

class MemoryIds implements RingIdStore {
  sets: string[] = [];
  constructor(public value: string | null = null) {}
  async get(): Promise<string | null> {
    return this.value;
  }
  async set(id: string): Promise<void> {
    this.value = id;
    this.sets.push(id);
  }
}

describe('CapacitorRingLink', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Avvia il collegamento e fa passare il tempo finché non finisce. */
  async function connect(link: CapacitorRingLink, onLost?: () => void): Promise<RingError | null> {
    const result = link.connect(() => undefined, onLost).then(
      () => null,
      (error: RingError) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    return result;
  }

  describe('cancelling (docs/adr/0043)', () => {
    it('a disconnect during a pending connect ends it at once with cancelled, and frees the ring', async () => {
      const ble = new FakeBle();
      ble.known.add(RING.deviceId);
      ble.hangConnect = true;
      const link = new CapacitorRingLink({ ble, ids: new MemoryIds(RING.deviceId) });
      let outcome: RingError | null | undefined;
      void link.connect(() => undefined).then(
        () => (outcome = null),
        (error: RingError) => (outcome = error),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(ble.calls).toContain(`connect ${RING.deviceId}`);
      await link.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toMatchObject({ code: 'cancelled' });
      expect(ble.calls).toContain(`disconnect ${RING.deviceId}`);
      expect(ble.calls).not.toContain('scan');
    });

    it('a disconnect during the search stops it and does not connect', async () => {
      const ble = new FakeBle();
      ble.reachable.add(RING.deviceId);
      ble.advertising = [{ ...RING, rssi: -50, at: 5_000 }];
      const link = new CapacitorRingLink({ ble, ids: new MemoryIds(null) });
      let outcome: RingError | null | undefined;
      void link.connect(() => undefined).then(
        () => (outcome = null),
        (error: RingError) => (outcome = error),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ble.calls).toContain('scan');
      await link.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(outcome).toMatchObject({ code: 'cancelled' });
      expect(ble.calls).toContain('stopScan');
      expect(ble.calls).not.toContain(`connect ${RING.deviceId}`);
    });
  });

  it('reaches the saved ring after an app restart: makes it known to the plugin first, without searching', async () => {
    const ble = new FakeBle();
    ble.known.add(RING.deviceId);
    ble.reachable.add(RING.deviceId);
    const ids = new MemoryIds(RING.deviceId);
    expect(await connect(new CapacitorRingLink({ ble, ids }))).toBeNull();
    expect(ble.calls).toEqual([
      'initialize',
      'attached',
      'attachedGeneric',
      'getDevices ring-1',
      'connect ring-1',
      'notify command',
      'notify big',
    ]);
    expect(ble.options).toEqual({ timeout: CONNECT_TIMEOUT_MS, skipDescriptorDiscovery: true });
    expect(ids.sets).toEqual([]);
  });

  it('prefers the ring the system already holds, and remembers it', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.reachable.add(RING.deviceId);
    const ids = new MemoryIds();
    expect(await connect(new CapacitorRingLink({ ble, ids }))).toBeNull();
    expect(ble.calls).toContain('connect ring-1');
    expect(ble.calls).not.toContain('scan');
    expect(ids.sets).toEqual(['ring-1']);
  });

  it('finds the ring held by the system through standard services, by name', async () => {
    const ble = new FakeBle();
    ble.attachedGeneric = [{ deviceId: 'keyboard', name: 'Tastiera' }, { deviceId: 'ring-3', name: 'COLMI Ring 2' }];
    ble.reachable.add('ring-3');
    expect(await connect(new CapacitorRingLink({ ble, ids: new MemoryIds() }))).toBeNull();
    expect(ble.calls.filter((c) => c.startsWith('connect'))).toEqual(['connect ring-3']);
  });

  it('never picks another device that Android lists as connected', async () => {
    const ble = new FakeBle();
    ble.attached = [{ deviceId: 'watch', name: 'Orologio' }];
    ble.reachable.add('watch');
    const error = await connect(new CapacitorRingLink({ ble, ids: new MemoryIds() }));
    expect(error).toMatchObject({ code: 'ring_not_found' });
    expect(ble.calls.filter((c) => c.startsWith('connect'))).toEqual([]);
  });

  it('searches when the saved ring does not answer, and switches to the ring it hears once confirmed', async () => {
    const ble = new FakeBle();
    ble.known.add('old');
    ble.advertising = [{ deviceId: 'new', name: 'COLMI Ring 2' }];
    ble.reachable.add('new');
    const ids = new MemoryIds('old');
    const choose = vi.fn(async () => 'new');
    expect(await connect(new CapacitorRingLink({ ble, ids, choose }))).toBeNull();
    expect(choose).toHaveBeenCalledWith({ rings: [{ id: 'new', name: 'COLMI Ring 2', rssi: null }], replacing: true });
    expect(ble.calls.filter((c) => /^(connect|scan|stopScan)/.test(c))).toEqual(['connect old', 'scan', 'stopScan', 'connect new']);
    expect(ids.value).toBe('new');
  });

  it('keeps the saved ring when it is nowhere to be found, and says so', async () => {
    const ble = new FakeBle();
    ble.known.add(RING.deviceId);
    const ids = new MemoryIds(RING.deviceId);
    const error = await connect(new CapacitorRingLink({ ble, ids }));
    expect(error).toBeInstanceOf(RingError);
    expect(error).toMatchObject({ code: 'ring_not_found', message: `non visto in ${SCAN_MS / 1000} s di ricerca` });
    expect(ble.calls).toContain('stopScan');
    expect(ids.value).toBe(RING.deviceId);
    expect(ids.sets).toEqual([]);
  });

  it('says the connection failed, with the reason, when the ring was heard but did not connect', async () => {
    const ble = new FakeBle();
    ble.advertising = [RING];
    ble.connectError = new Error('Failed to connect.');
    const error = await connect(new CapacitorRingLink({ ble, ids: new MemoryIds() }));
    expect(error).toMatchObject({ code: 'connection_timeout', message: 'collegamento non riuscito: Failed to connect.' });
  });

  it('never hangs on a plugin call that does not answer', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.hangConnect = true;
    const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
    let settled = false;
    const result = link.connect(() => undefined).then(
      () => null,
      (error: RingError) => error,
    );
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 2_000 + SCAN_MS + CALL_TIMEOUT_MS);
    expect(settled).toBe(true);
    expect(await result).toMatchObject({ code: 'connection_timeout', message: 'collegamento non riuscito: collegamento senza risposta' });
    // Il collegamento rimasto in sospeso si annulla.
    expect(ble.calls).toContain('disconnect ring-1');
  });

  it('stops at once when Bluetooth is off', async () => {
    const ble = new FakeBle();
    ble.enabled = false;
    ble.attached = [RING];
    expect(await connect(new CapacitorRingLink({ ble, ids: new MemoryIds() }))).toMatchObject({ code: 'bluetooth_off' });
    expect(ble.calls).toEqual(['initialize']);
  });

  it('does not search when the permission is missing', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.connectError = new Error('BLE permission denied');
    expect(await connect(new CapacitorRingLink({ ble, ids: new MemoryIds() }))).toMatchObject({ code: 'permission_denied' });
    expect(ble.calls).not.toContain('scan');
  });

  it('initialises the plugin only once', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.reachable.add(RING.deviceId);
    const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
    await connect(link);
    await link.disconnect();
    await connect(link);
    expect(ble.calls.filter((c) => c === 'initialize')).toHaveLength(1);
  });

  it('tells when the ring drops on its own, never after its own disconnect', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.reachable.add(RING.deviceId);
    const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
    const lost = vi.fn();
    await connect(link, lost);
    ble.onDisconnect.get(RING.deviceId)!(RING.deviceId);
    expect(lost).toHaveBeenCalledTimes(1);
    await expect(link.send('command', new Uint8Array(16))).rejects.toMatchObject({ code: 'disconnected' });

    await connect(link, lost);
    const late = ble.onDisconnect.get(RING.deviceId)!;
    await link.disconnect();
    late(RING.deviceId);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('writes to the connected ring', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.reachable.add(RING.deviceId);
    const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
    await connect(link);
    await link.send('command', new Uint8Array(16));
    expect(ble.calls.at(-1)).toBe('write ring-1');
  });

  it('reads firmware and hardware from Device Information once connected; what is missing stays empty (ADR 0030)', async () => {
    const ble = new FakeBle();
    ble.attached = [RING];
    ble.reachable.add(RING.deviceId);
    ble.deviceInfo.set('2a26', 'RT09CR2_3.00.03_260929\0');
    const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
    await expect(link.deviceInfo()).rejects.toMatchObject({ code: 'unknown' });
    await connect(link);
    expect(await link.deviceInfo()).toEqual({ name: null, firmware: 'RT09CR2_3.00.03_260929', hardware: null, address: null });
    expect(ble.calls.slice(-2)).toEqual(['read 2a26', 'read 2a27']);
  });

  describe('choosing the ring', () => {
    /** Una finestra finta: ricorda cosa le si chiede e risponde con `answer`. */
    function chooser(answer: (rings: readonly RingCandidate[]) => string | null | Promise<string | null>) {
      const asked: { ids: string[]; replacing: boolean }[] = [];
      const choose: RingChooser = async ({ rings, replacing }) => {
        asked.push({ ids: rings.map((r) => r.id), replacing });
        return answer(rings);
      };
      return { choose, asked };
    }

    it('takes the only ring it hears the first time, without asking', async () => {
      const ble = new FakeBle();
      ble.advertising = [{ ...RING, rssi: -50 }];
      ble.reachable.add(RING.deviceId);
      const { choose, asked } = chooser(() => null);
      expect(await connect(new CapacitorRingLink({ ble, ids: new MemoryIds(), choose }))).toBeNull();
      expect(asked).toEqual([]);
    });

    it('asks which one when it hears two or more, strongest signal first, and remembers the answer', async () => {
      const ble = new FakeBle();
      ble.advertising = [
        { deviceId: 'far', name: 'COLMI Ring 2', rssi: -85 },
        { deviceId: 'near', name: 'COLMI Ring 2', rssi: -48, at: 1_000 },
      ];
      ble.reachable.add('far');
      ble.reachable.add('near');
      const ids = new MemoryIds();
      const { choose, asked } = chooser((rings) => rings[0].id);
      expect(await connect(new CapacitorRingLink({ ble, ids, choose }))).toBeNull();
      expect(asked).toEqual([{ ids: ['near', 'far'], replacing: false }]);
      expect(ble.calls.filter((c) => c.startsWith('connect'))).toEqual(['connect near']);
      expect(ids.value).toBe('near');
    });

    it('listens a little longer after the first ring, not the whole search', async () => {
      const ble = new FakeBle();
      ble.advertising = [{ ...RING, rssi: -50 }];
      ble.reachable.add(RING.deviceId);
      const link = new CapacitorRingLink({ ble, ids: new MemoryIds() });
      let done = false;
      void link.connect(() => undefined).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 100);
      expect(done).toBe(true);
      expect(SETTLE_MS).toBeLessThan(SCAN_MS);
    });

    it('takes the saved ring among others without asking', async () => {
      const ble = new FakeBle();
      ble.advertising = [
        { deviceId: 'other', name: 'COLMI Ring 2', rssi: -40 },
        { ...RING, rssi: -70 },
      ];
      ble.reachable.add(RING.deviceId);
      const { choose, asked } = chooser(() => 'other');
      expect(await connect(new CapacitorRingLink({ ble, ids: new MemoryIds(RING.deviceId), choose }))).toBeNull();
      expect(asked).toEqual([]);
      expect(ble.calls.filter((c) => c.startsWith('connect'))).toEqual(['connect ring-1']);
    });

    it('asks before switching to a ring other than the saved one, even if it is the only one', async () => {
      const ble = new FakeBle();
      ble.advertising = [{ deviceId: 'other', name: 'COLMI Ring 2', rssi: -60 }];
      ble.reachable.add('other');
      const ids = new MemoryIds(RING.deviceId);
      const { choose, asked } = chooser(() => null);
      const error = await connect(new CapacitorRingLink({ ble, ids, choose }));
      expect(asked).toEqual([{ ids: ['other'], replacing: true }]);
      expect(error).toMatchObject({ code: 'ring_not_found', message: 'nessun anello scelto' });
      expect(ble.calls.filter((c) => c.startsWith('connect'))).toEqual([]);
      expect(ids.value).toBe(RING.deviceId);
    });

    it('does not ask again on the second attempt of the same reading', async () => {
      const ble = new FakeBle();
      ble.advertising = [
        { deviceId: 'a', name: 'COLMI Ring 2', rssi: -50 },
        { deviceId: 'b', name: 'COLMI Ring 2', rssi: -80 },
      ];
      ble.connectError = new Error('Failed to connect.');
      const { choose, asked } = chooser(() => 'a');
      const link = new CapacitorRingLink({ ble, ids: new MemoryIds(), choose });
      expect(await connect(link)).toMatchObject({ code: 'connection_timeout' });
      ble.reachable.add('a');
      expect(await connect(link)).toBeNull();
      expect(asked).toHaveLength(1);
    });

    it('gives up when nobody answers', async () => {
      const ble = new FakeBle();
      ble.advertising = [
        { deviceId: 'a', name: 'COLMI Ring 2', rssi: -50 },
        { deviceId: 'b', name: 'COLMI Ring 2', rssi: -80 },
      ];
      const link = new CapacitorRingLink({ ble, ids: new MemoryIds(), choose: () => new Promise(() => undefined) });
      const result = link.connect(() => undefined).then(
        () => null,
        (error: RingError) => error,
      );
      await vi.advanceTimersByTimeAsync(SCAN_MS + CHOOSE_TIMEOUT_MS + 5_000);
      expect(await result).toMatchObject({ code: 'ring_not_found', message: 'nessun anello scelto' });
    });
  });
});
