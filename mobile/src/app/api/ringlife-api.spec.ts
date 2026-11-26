import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { SamplePayload, SleepSessionPayload } from './api.model';
import { ApiError } from './api-error';
import { BinaryHttp } from './binary-http';
import { CredentialsRepository } from './credentials.repository';
import { CredentialsService } from './credentials.service';
import { RingLifeApi } from './ringlife-api';
import { InMemoryCredentialsRepository } from './testing';

const URL = 'https://ringlife.example.net';

describe('RingLifeApi', () => {
  let api: RingLifeApi;
  let http: HttpTestingController;
  let credentials: CredentialsService;
  let settings: SettingsService;

  async function setup(options: { serverUrl?: string; paired?: boolean } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: options.serverUrl ?? URL }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    });
    api = TestBed.inject(RingLifeApi);
    http = TestBed.inject(HttpTestingController);
    credentials = TestBed.inject(CredentialsService);
    settings = TestBed.inject(SettingsService);
    await settings.init();
    await credentials.init();
    if (options.paired) {
      await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    }
  }

  afterEach(() => http.verify());

  /** Lascia girare le promesse in sospeso: il gruppo successivo parte solo dopo la risposta del precedente. */
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

  const samples = (n: number): SamplePayload[] =>
    Array.from({ length: n }, (_, i) => ({ metric: 'HR', ts: 1_793_577_600_000 + i * 300_000, value: 60 }));

  // --- stato del server ---

  it('says the server is up when it answers UP', async () => {
    await setup();
    const result = api.health();
    http.expectOne(`${URL}/actuator/health`).flush({ status: 'UP' });
    expect(await result).toBe(true);
  });

  it('says the server is down on an error, a bad status or no answer, without throwing', async () => {
    await setup();
    let result = api.health();
    http.expectOne(`${URL}/actuator/health`).flush({ status: 'DOWN' });
    expect(await result).toBe(false);

    result = api.health();
    http.expectOne(`${URL}/actuator/health`).flush('x', { status: 503, statusText: 'Service Unavailable' });
    expect(await result).toBe(false);

    result = api.health();
    http.expectOne(`${URL}/actuator/health`).error(new ProgressEvent('error'));
    expect(await result).toBe(false);
  });

  it('says the server is down when no address is set', async () => {
    await setup({ serverUrl: '' });
    expect(await api.health()).toBe(false);
  });

  // --- registrazione ---

  it('registers with the pairing secret in a header, never in the body, and stores the access', async () => {
    await setup();
    const result = api.register('synthetic-secret');
    const request = http.expectOne(`${URL}/api/v1/devices`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Pairing-Secret')).toBe('synthetic-secret');
    expect(JSON.stringify(request.request.body)).not.toContain('synthetic-secret');
    expect(request.request.body).toEqual({ hardwareId: credentials.hardwareId(), model: 'R09' });
    request.flush({ deviceId: 'dev-9', token: 'tok-9' });
    await result;
    expect(credentials.paired()).toEqual({ deviceId: 'dev-9', token: 'tok-9' });
  });

  it('turns registration failures into typed errors and stores nothing', async () => {
    await setup();
    const cases: [number, string][] = [[401, 'unauthorized'], [404, 'disabled'], [400, 'rejected'], [500, 'server']];
    for (const [status, kind] of cases) {
      const result = api.register('x');
      http.expectOne(`${URL}/api/v1/devices`).flush('', { status, statusText: 'err' });
      await expect(result).rejects.toMatchObject({ kind });
    }
    const offline = api.register('x');
    http.expectOne(`${URL}/api/v1/devices`).error(new ProgressEvent('error'));
    await expect(offline).rejects.toMatchObject({ kind: 'offline' });
    expect(credentials.paired()).toBeNull();
  });

  it('refuses to register without a server address', async () => {
    await setup({ serverUrl: '' });
    await expect(api.register('x')).rejects.toMatchObject({ kind: 'not-configured' });
  });

  // --- caricamento ---

  it('needs the pairing before it uploads, and sends nothing without it', async () => {
    await setup();
    await expect(api.uploadSamples(samples(1), 60)).rejects.toBeInstanceOf(ApiError);
    await expect(api.uploadSamples(samples(1), 60)).rejects.toMatchObject({ kind: 'not-paired' });
    http.expectNone(() => true);
  });

  it('uploads samples with the bearer token and the timezone offset', async () => {
    await setup({ paired: true });
    const result = api.uploadSamples(samples(2), 60);
    const request = http.expectOne(`${URL}/api/v1/devices/dev-1/samples`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(request.request.body.tzOffsetMin).toBe(60);
    expect(request.request.body.samples).toHaveLength(2);
    request.flush({ received: 2, inserted: 2, duplicates: 0 });
    expect(await result).toEqual({ received: 2, inserted: 2, duplicates: 0 });
  });

  it('splits a big upload into groups of 5.000 and adds up the results', async () => {
    await setup({ paired: true });
    const result = api.uploadSamples(samples(12_000), 120);
    for (const [size, inserted] of [[5000, 5000], [5000, 4000], [2000, 0]]) {
      await tick();
      const request = http.expectOne(`${URL}/api/v1/devices/dev-1/samples`);
      expect(request.request.body.samples).toHaveLength(size);
      expect(request.request.body.tzOffsetMin).toBe(120);
      request.flush({ received: size, inserted, duplicates: size - inserted });
    }
    expect(await result).toEqual({ received: 12_000, inserted: 9000, duplicates: 3000 });
  });

  it('stops at the first failed group, so the caller can repeat the whole upload safely', async () => {
    await setup({ paired: true });
    const result = api.uploadSamples(samples(6000), 60);
    http.expectOne(`${URL}/api/v1/devices/dev-1/samples`).flush({ received: 5000, inserted: 5000, duplicates: 0 });
    await tick();
    http.expectOne(`${URL}/api/v1/devices/dev-1/samples`).error(new ProgressEvent('error'));
    await expect(result).rejects.toMatchObject({ kind: 'offline' });
    http.expectNone(() => true);
  });

  it('sends nothing for an empty upload', async () => {
    await setup({ paired: true });
    expect(await api.uploadSamples([], 60)).toEqual({ received: 0, inserted: 0, duplicates: 0 });
    http.expectNone(() => true);
  });

  it('uploads sleep sessions to their own route', async () => {
    await setup({ paired: true });
    const session: SleepSessionPayload = {
      start: 1_793_577_600_000,
      end: 1_793_604_600_000,
      stages: [{ stage: 'light', start: 1_793_577_600_000, end: 1_793_580_600_000 }],
    };
    const result = api.uploadSleep([session], 60);
    const request = http.expectOne(`${URL}/api/v1/devices/dev-1/sleep`);
    expect(request.request.body.sessions).toEqual([session]);
    request.flush({ received: 1, inserted: 1, duplicates: 0 });
    expect(await result).toEqual({ received: 1, inserted: 1, duplicates: 0 });
  });

  it('reports a revoked or wrong token as unauthorized', async () => {
    await setup({ paired: true });
    const result = api.uploadSamples(samples(1), 60);
    http.expectOne(`${URL}/api/v1/devices/dev-1/samples`).flush({ error: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  // --- lettura ---

  it('reads one day and a range', async () => {
    await setup({ paired: true });
    const day = api.getDay('2026-11-12');
    const one = http.expectOne(`${URL}/api/v1/devices/dev-1/days/2026-11-12`);
    expect(one.request.headers.get('Authorization')).toBe('Bearer tok-1');
    one.flush({ day: '2026-11-12', scores: { sleep: { value: 72, algoVersion: 'v1', components: [] } }, metrics: {}, baselines: {} });
    expect((await day).scores['sleep'].value).toBe(72);

    const range = api.getDays('2026-11-10', '2026-11-12');
    const many = http.expectOne((r) => r.url === `${URL}/api/v1/devices/dev-1/days`);
    expect(many.request.params.get('from')).toBe('2026-11-10');
    expect(many.request.params.get('to')).toBe('2026-11-12');
    many.flush([]);
    expect(await range).toEqual([]);
  });

  it('follows the server address chosen in settings', async () => {
    await setup({ paired: true });
    await settings.update({ serverUrl: 'http://192.0.2.10:8080' });
    const result = api.getDay('2026-11-12');
    http.expectOne('http://192.0.2.10:8080/api/v1/devices/dev-1/days/2026-11-12').flush({});
    await result;
  });

  // --- report per il medico ---

  describe('migraine report', () => {
    function binary(result: { status: number; base64: string } | Error) {
      const get = vi.fn(async () => {
        if (result instanceof Error) {
          throw result;
        }
        return result;
      });
      TestBed.overrideProvider(BinaryHttp, { useValue: { get } });
      return get;
    }

    it('reads the preview data of the period', async () => {
      await setup({ paired: true });
      const result = api.getMigraineReportData(90);
      const req = http.expectOne((r) => r.url === `${URL}/api/v1/devices/dev-1/reports/migraine/summary`);
      expect(req.request.params.get('days')).toBe('90');
      expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
      req.flush({ from: '2026-08-07', to: '2026-11-04', days: 90, summary: null, episodes: [], recurrences: [] });
      expect((await result).days).toBe(90);
    });

    it('asks for the PDF with the token and returns it in base64', async () => {
      const get = binary({ status: 200, base64: 'JVBERi0=' });
      await setup({ paired: true });
      expect(await api.getMigraineReportPdf(30)).toBe('JVBERi0=');
      expect(get).toHaveBeenCalledWith(
        `${URL}/api/v1/devices/dev-1/reports/migraine?days=30`,
        { Authorization: 'Bearer tok-1', Accept: 'application/pdf' },
        expect.any(Number),
      );
    });

    it('names the error for a refused or failed request', async () => {
      const cases: [number, string, string][] = [
        [401, '', 'unauthorized'],
        [400, '', 'rejected'],
        [500, '', 'server'],
        [200, '', 'server'], // risposta vuota: non e' un PDF
      ];
      for (const [status, base64, kind] of cases) {
        TestBed.resetTestingModule();
        binary({ status, base64 });
        await setup({ paired: true });
        await expect(api.getMigraineReportPdf(30)).rejects.toMatchObject({ kind });
      }
    });

    it('says offline when nothing answers', async () => {
      binary(new Error('network'));
      await setup({ paired: true });
      await expect(api.getMigraineReportPdf(30)).rejects.toMatchObject({ kind: 'offline' });
    });

    it('needs a paired phone', async () => {
      await setup();
      await expect(api.getMigraineReportPdf(30)).rejects.toMatchObject({ kind: 'not-paired' });
    });
  });
});
