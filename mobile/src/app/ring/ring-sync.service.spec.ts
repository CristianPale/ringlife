import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api/api-error';
import { SamplePayload, SleepSessionPayload } from '../api/api.model';
import { CredentialsService } from '../api/credentials.service';
import { RingLifeApi } from '../api/ringlife-api';
import { Clock } from '../diary/clock';
import { FakeClock } from '../diary/testing';
import { SettingsService } from '../settings/settings.service';
import { InMemoryRingQueueRepository, RingQueueRepository } from './ring-queue.repository';
import { RingError } from './ring-source';
import { RingSourceProvider } from './ring-source.provider';
import { RING_RETRY_PAUSE_MS, RingSyncService } from './ring-sync.service';
import { ScriptedRingSource } from './testing';
import { BackgroundBridge, FakeBackgroundBridge } from './background/ring-background';
import { RingDeviceService } from './ring-device.service';
import { TemperatureLogService } from './temperature-log.service';
import { HeartRateLogService } from './heart-rate-log.service';
import { ManualMeasureLogService } from './manual-measure-log.service';
import { StepsLogService } from './steps-log.service';

const RING = { hrIntervalMin: 5, stress: true, spo2: true, hrv: true, temperature: true };
const hr = (ts: number): SamplePayload => ({ metric: 'HR', ts, value: 60 });
const night: SleepSessionPayload = { start: 100, end: 900, stages: [] };

describe('RingSyncService', () => {
  const clock = new FakeClock(new Date('2026-11-05T08:00:00Z'));

  function setup(options: { server?: boolean; ring?: boolean } = {}) {
    const { server = true, ring = true } = options;
    const source = new ScriptedRingSource();
    const upload = {
      uploadSamples: vi.fn(async () => ({ received: 0, inserted: 0, duplicates: 0 })),
      uploadSleep: vi.fn(async () => ({ received: 0, inserted: 0, duplicates: 0 })),
    };
    const repository = new InMemoryRingQueueRepository();
    const ringSettings = { ...RING };
    const none = Object.assign(new ScriptedRingSource(), { kind: 'none' as const });
    const background = new FakeBackgroundBridge();
    TestBed.configureTestingModule({
      providers: [
        { provide: RingQueueRepository, useValue: repository },
        { provide: RingSourceProvider, useValue: { current: () => (ring ? source : none) } },
        { provide: RingLifeApi, useValue: upload },
        { provide: CredentialsService, useValue: { paired: () => (server ? { deviceId: 'd', token: 't' } : null) } },
        { provide: SettingsService, useValue: { settings: () => ({ serverUrl: server ? 'https://casa.example' : '', ring: ringSettings }) } },
        { provide: Clock, useValue: clock },
        { provide: BackgroundBridge, useValue: background },
        { provide: RING_RETRY_PAUSE_MS, useValue: 0 },
      ],
    });
    return { service: TestBed.inject(RingSyncService), source, upload, repository, ringSettings, background };
  }

  it('records who the real ring is, and its firmware becomes the last reading firmware', async () => {
    const { service, source } = setup();
    source.info = { name: 'COLMI Ring 2', firmware: 'RT09_3.00.03', hardware: 'R09', address: null };
    source.reading = { samples: [], sessions: [], firmware: 'old' };
    await service.sync();
    const devices = TestBed.inject(RingDeviceService);
    expect(devices.device()).toMatchObject({ name: 'COLMI Ring 2', firmware: 'RT09_3.00.03', seenAt: clock.now().getTime() });
    expect(service.last()?.firmware).toBe('RT09_3.00.03');
  });

  it('moves the «ring not read» reminder forward after a good reading, not after a failed one', async () => {
    const { service, source, background } = setup();
    await service.sync();
    expect(background.ringReads).toBe(1);
    source.failAt = 'battery';
    await service.sync();
    expect(background.ringReads).toBe(1);
  });

  it('cancels before reading: no ring, no upload', async () => {
    const { service, source, upload } = setup();
    source.reading = { samples: [hr(1_000)], sessions: [] };
    const running = service.sync();
    await service.cancel();
    await running;
    // Solo lo scollegamento dell'annullamento: nessun collegamento, nessuna lettura.
    expect(source.calls).toEqual(['disconnect']);
    expect(upload.uploadSamples).not.toHaveBeenCalled();
  });

  it('cancels during the reading: no second attempt, no error to show, nothing sent', async () => {
    const { service, source, upload } = setup();
    source.readHistory = async () => {
      void service.cancel();
      throw new RingError('disconnected');
    };
    await service.sync();
    expect(source.calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(service.ringError()).toBeNull();
    expect(upload.uploadSamples).not.toHaveBeenCalled();
  });

  it('keeps the steps on the phone and knows the last night, with its sleep time while it is queued', async () => {
    const { service, source } = setup({ server: false });
    const steps = (ts: number, value: number): SamplePayload => ({ metric: 'STEPS', ts, value });
    source.reading = {
      samples: [steps(clock.now().getTime() - 3_600_000, 300), steps(clock.now().getTime() - 1_800_000, 450)],
      sessions: [
        {
          start: 1_000,
          end: 1_000 + 8 * 3_600_000,
          stages: [
            { stage: 'light', start: 1_000, end: 1_000 + 7 * 3_600_000 },
            { stage: 'awake', start: 1_000 + 7 * 3_600_000, end: 1_000 + 8 * 3_600_000 },
          ],
        },
      ],
    };
    await service.sync();
    expect(TestBed.inject(StepsLogService).readings().map((r) => r.steps)).toEqual([300, 450]);
    expect(service.lastNight()).toEqual({ start: 1_000, end: 1_000 + 8 * 3_600_000, asleepMs: 7 * 3_600_000 });
  });

  it('loads the log of background attempts, failed ones included, at every sync', async () => {
    const { service, background } = setup();
    background.log = [{ at: 1, end: 26_001, source: 'shortcut', outcome: 'time_limit', stage: 'hr:0', done: 5, total: 13, chain: '' }];
    await service.sync();
    expect(service.backgroundAttempts()).toEqual(background.log);
  });

  it('keeps the temperatures of the reading on the phone for the Temperatura page', async () => {
    const { service, source } = setup();
    const ts = clock.now().getTime() - 60_000;
    source.reading = { samples: [hr(10), { metric: 'TEMP', ts, value: 36.3 }], sessions: [] };
    await service.sync();
    expect(TestBed.inject(TemperatureLogService).latest()).toEqual({ ts, celsius: 36.3 });
  });

  it('keeps the heart rate of the reading on the phone for the chart in Oggi', async () => {
    const { service, source } = setup();
    const ts = clock.now().getTime() - 5 * 60_000;
    source.reading = { samples: [{ metric: 'HR', ts, value: 64 }, { metric: 'TEMP', ts, value: 36.3 }], sessions: [] };
    await service.sync();
    expect(TestBed.inject(HeartRateLogService).readings()).toEqual([{ ts, bpm: 64 }]);
  });

  it('never records the demo ring as the real one', async () => {
    const { service, source } = setup();
    Object.assign(source, { kind: 'demo' as const });
    source.info = { name: 'Anello di prova', firmware: 'demo', hardware: null, address: null };
    await service.sync();
    expect(TestBed.inject(RingDeviceService).device()).toBeNull();
  });

  it('goes on reading when the ring does not say who it is', async () => {
    const { service, source } = setup();
    vi.spyOn(source, 'deviceInfo').mockRejectedValue(new Error('no 180a'));
    await service.sync();
    expect(service.ringError()).toBeNull();
    expect(source.calls).toContain('readHistory');
  });

  it('reads the ring in order, queues, sends, and always disconnects', async () => {
    const { service, source, upload, repository } = setup();
    source.reading = { samples: [hr(10), hr(20)], sessions: [night], firmware: '1.2' };
    await service.sync();
    expect(source.calls).toEqual(['connect', 'setTime', 'applySettings', 'battery', 'readHistory', 'disconnect']);
    expect(upload.uploadSamples).toHaveBeenCalledWith([hr(10), hr(20)], expect.any(Number));
    expect(upload.uploadSleep).toHaveBeenCalledWith([night], expect.any(Number));
    expect(service.pending()).toBe(0);
    expect(service.last()).toEqual({ at: clock.now().getTime(), battery: 80, firmware: '1.2' });
    expect(service.ringError()).toBeNull();
    expect(service.uploadError()).toBeNull();
    expect((await repository.load()).cursors).toEqual({ HR: 20, sleep: 900 });
  });

  it('keeps the data on the phone when there is no server, and sends it once there is one', async () => {
    const { service, source, upload } = setup({ server: false });
    source.reading = { samples: [hr(10)], sessions: [] };
    await service.sync();
    expect(upload.uploadSamples).not.toHaveBeenCalled();
    expect(service.pending()).toBe(1);
  });

  it('starts the next reading from the saved position', async () => {
    const { service, source } = setup();
    source.reading = { samples: [hr(10), hr(20)], sessions: [] };
    await service.sync();
    await service.sync();
    expect(source.sinceSeen).toEqual([null, 20]);
  });

  it('keeps what the server did not take and moves on without reading the ring twice', async () => {
    const { service, source, upload } = setup();
    upload.uploadSamples.mockRejectedValueOnce(new ApiError('offline'));
    source.reading = { samples: [hr(10)], sessions: [night] };
    await service.sync();
    expect(service.uploadError()?.kind).toBe('offline');
    expect(service.pending()).toBe(2);
    expect(upload.uploadSleep).not.toHaveBeenCalled();

    await service.sync();
    expect(source.sinceSeen).toEqual([null, 10]);
    expect(service.pending()).toBe(0);
    expect(service.uploadError()).toBeNull();
  });

  it('removes what was sent even if the next part fails', async () => {
    const { service, source, upload } = setup();
    upload.uploadSleep.mockRejectedValueOnce(new ApiError('server'));
    source.reading = { samples: [hr(10)], sessions: [night] };
    await service.sync();
    expect(service.pending()).toBe(1);
    await service.sync();
    expect(upload.uploadSamples).toHaveBeenCalledTimes(1);
    expect(upload.uploadSleep).toHaveBeenCalledTimes(2);
    expect(service.pending()).toBe(0);
  });

  it('says what went wrong with the ring, still disconnects, and still sends what was waiting', async () => {
    const { service, source, upload } = setup();
    source.reading = { samples: [hr(10)], sessions: [] };
    upload.uploadSamples.mockRejectedValueOnce(new ApiError('offline'));
    await service.sync();
    expect(service.pending()).toBe(1);

    source.failAt = 'connect';
    source.failWith = new RingError('ring_not_found');
    await service.sync();
    expect(service.ringError()).toContain('Non trovo l\'anello');
    expect(source.calls.at(-1)).toBe('disconnect');
    expect(service.pending()).toBe(0);
  });

  it('disconnects after a failure in the middle of the reading, tries once more, then says what went wrong', async () => {
    const { service, source } = setup();
    source.failAt = 'readHistory';
    source.failWith = new RingError('connection_timeout');
    await service.sync();
    const once = ['connect', 'setTime', 'applySettings', 'battery', 'readHistory', 'disconnect'];
    // Il secondo giro non riscrive le misure: già scritte nel primo.
    expect(source.calls).toEqual([...once, 'connect', 'setTime', 'battery', 'readHistory', 'disconnect']);
    expect(service.ringError()).toContain('non ha risposto');
    expect(service.last()).toBeNull();
  });

  it('keeps the second reading when the first one lost the ring', async () => {
    const { service, source } = setup();
    source.reading = { samples: [hr(10)], sessions: [] };
    source.failAt = 'battery';
    source.failWith = new RingError('disconnected');
    source.failures = 1;
    await service.sync();
    expect(source.calls.filter((c) => c === 'connect')).toHaveLength(2);
    expect(source.calls.filter((c) => c === 'disconnect')).toHaveLength(2);
    expect(service.ringError()).toBeNull();
    expect(service.last()?.battery).toBe(80);
    expect(service.pending()).toBe(0);
  });

  it('does not try again when the ring was not found or Bluetooth is off', async () => {
    for (const code of ['ring_not_found', 'bluetooth_off', 'permission_denied'] as const) {
      TestBed.resetTestingModule();
      const { service, source } = setup();
      source.failAt = 'connect';
      source.failWith = new RingError(code);
      await service.sync();
      expect(source.calls).toEqual(['connect', 'disconnect']);
    }
  });

  it('names an unexpected failure without showing its text', async () => {
    const { service, source } = setup();
    source.failAt = 'battery';
    await service.sync();
    expect(service.ringError()).toBe("Lettura dell'anello non riuscita.");
  });

  it('only sends the queue when there is no ring', async () => {
    const { service, source, upload } = setup({ ring: false });
    expect(service.hasRing()).toBe(false);
    await service.sync();
    expect(source.calls).toEqual([]);
    expect(upload.uploadSamples).not.toHaveBeenCalled();
    expect(service.active()).toBe(false);
  });

  describe('background chain (docs/adr/0048)', () => {
    it('imports and sends without touching the ring, and says each step', async () => {
      const { service, source } = setup();
      const steps: string[] = [];
      expect(await service.backgroundChain(async (step) => void steps.push(step))).toBe(true);
      expect(steps).toEqual(['decoded', 'uploaded']);
      expect(source.calls).toEqual([]);
    });

    it('stops after decoding without a server', async () => {
      const { service } = setup({ server: false });
      const steps: string[] = [];
      expect(await service.backgroundChain(async (step) => void steps.push(step))).toBe(false);
      expect(steps).toEqual(['decoded']);
    });

    it('a sync asked during the chain waits for it, and a chain never starts during a sync', async () => {
      const { service, source } = setup();
      let release: () => void = () => undefined;
      let reached: () => void = () => undefined;
      const reachedReport = new Promise<void>((resolve) => (reached = resolve));
      const chain = service.backgroundChain((step) => {
        if (step !== 'decoded') {
          return Promise.resolve();
        }
        reached();
        return new Promise<void>((resolve) => (release = resolve));
      });
      await reachedReport;
      const sync = service.sync();
      await new Promise((resolve) => setTimeout(resolve));
      expect(source.calls).toEqual([]);
      expect(await service.backgroundChain(async () => undefined)).toBe(false);
      release();
      await chain;
      await sync;
      expect(source.calls[0]).toBe('connect');
    });
  });

  it('runs one sync at a time', async () => {
    const { service, source } = setup();
    source.reading = { samples: [hr(10)], sessions: [] };
    await Promise.all([service.sync(), service.sync()]);
    expect(source.calls.filter((c) => c === 'connect')).toHaveLength(1);
  });

  it('writes the chosen measures to the ring only when they changed', async () => {
    const { service, source, ringSettings } = setup();
    await service.sync();
    await service.sync();
    expect(source.appliedSettings).toEqual([RING]);
    ringSettings.hrIntervalMin = 15;
    await service.sync();
    expect(source.appliedSettings).toEqual([RING, { ...RING, hrIntervalMin: 15 }]);
  });

  it('rereads the measures on the ring and turns on again the ones it lost (docs/adr/0049)', async () => {
    const { service, source } = setup();
    source.measures = { hrIntervalMin: RING.hrIntervalMin, stress: RING.stress, spo2: RING.spo2, hrv: RING.hrv, temperature: RING.temperature };
    await service.sync();
    // L'anello ha già tutto acceso: niente da scrivere.
    expect(source.appliedSettings).toEqual([]);
    source.measures = { ...source.measures, temperature: false };
    await service.sync();
    expect(source.appliedSettings).toEqual([RING]);
    expect(service.measuresRestored()?.names).toEqual(['temperatura']);
  });

  it('a measure the ring does not tell counts as written only if the settings did not change', async () => {
    const { service, source, ringSettings } = setup();
    source.measures = { hrIntervalMin: RING.hrIntervalMin, stress: null, spo2: RING.spo2, hrv: RING.hrv, temperature: RING.temperature };
    // Mai scritte prima: si scrivono.
    await service.sync();
    expect(source.appliedSettings).toEqual([RING]);
    // Scritte e uguali: lo stress che l'anello non dice vale come scritto.
    await service.sync();
    expect(source.appliedSettings).toEqual([RING]);
    ringSettings.stress = !RING.stress;
    await service.sync();
    expect(source.appliedSettings).toEqual([RING, { ...RING, stress: !RING.stress }]);
    expect(service.measuresRestored()).toBeNull();
  });

  it('does not stop the reading when the measures cannot be written, and tries again next time', async () => {
    const { service, source } = setup();
    source.reading = { samples: [hr(10)], sessions: [] };
    source.failAt = 'applySettings';
    source.failWith = new RingError('connection_timeout');
    await service.sync();
    expect(service.settingsError()).toContain('non ha risposto');
    expect(service.ringError()).toBeNull();
    expect(service.last()?.battery).toBe(80);
    expect(service.pending()).toBe(0);

    source.failAt = null;
    await service.sync();
    expect(service.settingsError()).toBeNull();
    expect(source.appliedSettings).toEqual([RING]);
  });

  it('remembers whether the ring was on the charger at the last reading', async () => {
    const { service, source } = setup();
    source.charging = true;
    await service.sync();
    expect(service.charging()).toBe(true);
    source.charging = false;
    await service.sync();
    expect(service.charging()).toBe(false);
  });

  it('reads only the battery while charging: saved percent and charging state, then disconnects', async () => {
    const { service, source, repository, background } = setup();
    source.charging = true;
    await service.sync();
    source.calls.length = 0;
    source.batteryPercent = 85;
    expect(await service.refreshBattery()).toBe(true);
    expect(source.calls).toEqual(['connect', 'battery', 'disconnect']);
    expect(service.last()?.battery).toBe(85);
    expect((await repository.load()).last?.battery).toBe(85);
    expect(service.charging()).toBe(true);
    expect(background.batteries.at(-1)).toBe(85);

    source.charging = false;
    await service.refreshBattery();
    expect(service.charging()).toBe(false);
  });

  it('never reads the battery during a sync, and a sync waits for a battery read to end', async () => {
    const { service, source } = setup();
    const sync = service.sync();
    expect(await service.refreshBattery()).toBe(false);
    await sync;
    source.calls.length = 0;
    const battery = service.refreshBattery();
    expect(service.busy()).toBe(true);
    await Promise.all([battery, service.sync()]);
    expect(source.calls.slice(0, 4)).toEqual(['connect', 'battery', 'disconnect', 'connect']);
    expect(service.busy()).toBe(false);
  });

  it('keeps quiet when a battery read fails, and frees the ring', async () => {
    const { service, source } = setup();
    source.failAt = 'battery';
    source.failWith = new RingError('connection_timeout');
    expect(await service.refreshBattery()).toBe(false);
    expect(service.ringError()).toBeNull();
    expect(source.calls).toEqual(['connect', 'battery', 'disconnect']);
  });

  describe('measures on demand', () => {
    it('connects, measures, disconnects, and keeps the measure on the phone only', async () => {
      const { service, source, upload } = setup();
      source.measured.spo2 = 96;
      const result = await service.measure('spo2');
      expect(result).toEqual({ ok: true, kind: 'spo2', value: 96, ts: clock.now().getTime() });
      expect(source.calls).toEqual(['connect', 'measure:spo2', 'disconnect']);
      expect(TestBed.inject(ManualMeasureLogService).measures().spo2).toEqual({ ts: clock.now().getTime(), value: 96 });
      expect(TestBed.inject(TemperatureLogService).latest()).toBeNull();
      expect(upload.uploadSamples).not.toHaveBeenCalled();
      expect(service.measuring()).toBeNull();
    });

    it('also keeps a temperature among the temperatures of the day', async () => {
      const { service, source } = setup();
      source.measured.temperature = 36.6;
      await service.measure('temperature');
      expect(TestBed.inject(TemperatureLogService).latest()).toEqual({ ts: clock.now().getTime(), celsius: 36.6, manual: true });
    });

    it('says why the measure failed, and frees the ring', async () => {
      const { service, source } = setup();
      source.measured.hrv = new RingError('measure_failed');
      const result = await service.measure('hrv');
      expect(result).toEqual({ ok: false, kind: 'hrv', message: expect.stringContaining('ben indossato') });
      expect(source.calls).toEqual(['connect', 'measure:hrv', 'disconnect']);
      expect(TestBed.inject(ManualMeasureLogService).measures().hrv).toBeUndefined();
    });

    it('does not keep an impossible value', async () => {
      const { service, source } = setup();
      source.measured.temperature = 61.5;
      expect(await service.measure('temperature')).toMatchObject({ ok: false });
      expect(TestBed.inject(TemperatureLogService).latest()).toBeNull();
    });

    it('never measures during a sync, and a sync waits for a measure to end', async () => {
      const { service, source } = setup();
      const sync = service.sync();
      expect(await service.measure('stress')).toMatchObject({ ok: false, message: expect.stringContaining('impegnato') });
      await sync;
      source.calls.length = 0;
      const measure = service.measure('stress');
      expect(service.busy()).toBe(true);
      expect(service.measuring()).toBe('stress');
      expect(await service.refreshBattery()).toBe(false);
      expect(await service.measure('heartRate')).toMatchObject({ ok: false });
      await Promise.all([measure, service.sync()]);
      expect(source.calls.slice(0, 4)).toEqual(['connect', 'measure:stress', 'disconnect', 'connect']);
      expect(service.busy()).toBe(false);
    });

    it('says when there is no ring to measure', async () => {
      const { service } = setup({ ring: false });
      expect(await service.measure('heartRate')).toMatchObject({ ok: false });
    });
  });

  it('discards impossible values and says how many', async () => {
    const { service, source, upload } = setup();
    source.reading = { samples: [hr(10), { metric: 'HR', ts: 20, value: 255 }, { metric: 'SPO2', ts: 30, value: 97 }], sessions: [] };
    await service.sync();
    expect(service.discarded()).toBe(1);
    expect(upload.uploadSamples).toHaveBeenCalledWith([hr(10), { metric: 'SPO2', ts: 30, value: 97 }], expect.any(Number));
    await service.sync();
    expect(service.discarded()).toBe(1);
  });

  it('reloads the queue saved before', async () => {
    const { service, source, repository } = setup({ server: false });
    source.reading = { samples: [hr(10)], sessions: [] };
    await service.sync();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: RingQueueRepository, useValue: repository },
        { provide: RingSourceProvider, useValue: { current: () => source } },
        { provide: RingLifeApi, useValue: {} },
        { provide: CredentialsService, useValue: { paired: () => null } },
        { provide: SettingsService, useValue: { settings: () => ({ serverUrl: '', ring: RING }) } },
        { provide: Clock, useValue: clock },
      ],
    });
    const again = TestBed.inject(RingSyncService);
    await again.init();
    expect(again.pending()).toBe(1);
    expect(again.last()?.battery).toBe(80);
  });

  describe('background readings', () => {
    it('hands the battery of every reading to the native alerts', async () => {
      const { service, background } = setup();
      await service.sync();
      expect(background.batteries).toEqual([80]);
    });

    it('queues and sends what the phone read in background, before reading the ring', async () => {
      const { service, background, upload } = setup({ ring: false });
      const at = clock.now().getTime() - 3_600_000;
      // Un battito delle 07:00 locali dentro una lettura in background (sintetica, già nel formato del nativo).
      background.json = JSON.stringify([{ at, tzOffsetMin: 60, battery: 40, requests: [] }]);
      background.lastRun = at;
      await service.sync();
      expect(service.lastBackground()).toBe(at);
      expect(service.last()).toEqual({ at, battery: 40, firmware: null });
      expect(upload.uploadSamples).not.toHaveBeenCalled();
    });
  });
});
