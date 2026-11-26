import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { CredentialsRepository } from './credentials.repository';
import { CredentialsService } from './credentials.service';
import { RingLifeApi } from './ringlife-api';
import { InMemoryCredentialsRepository } from './testing';

const REMOTE = 'https://ringlife.example.net';
const HOME = 'http://192.168.1.20:8080';

describe('RingLifeApi on the home network', () => {
  let api: RingLifeApi;
  let http: HttpTestingController;

  async function setup(homeUrl = HOME) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: REMOTE, homeUrl }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    });
    api = TestBed.inject(RingLifeApi);
    http = TestBed.inject(HttpTestingController);
    await TestBed.inject(SettingsService).init();
    const credentials = TestBed.inject(CredentialsService);
    await credentials.init();
    await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
  }

  afterEach(() => http.verify());

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve));
  const networkError = () => new ProgressEvent('error');

  it('reports which route answered', async () => {
    await setup();
    const result = api.healthRoute();
    http.expectOne(`${REMOTE}/actuator/health`).flush({ status: 'UP' });
    expect(await result).toBe('remote');
  });

  it('reaches the server through the home address when Tailscale is off', async () => {
    await setup();
    const result = api.healthRoute();
    http.expectOne(`${REMOTE}/actuator/health`).error(networkError());
    await tick();
    http.expectOne(`${HOME}/actuator/health`).flush({ status: 'UP' });
    expect(await result).toBe('home');
  });

  it('sends the token to the home address only after the HTTPS address failed to answer', async () => {
    await setup();
    const result = api.getDays('2026-11-01', '2026-11-03');
    http.expectOne((r) => r.url.startsWith(REMOTE)).error(networkError());
    await tick();
    const request = http.expectOne((r) => r.url.startsWith(HOME));
    expect(request.request.headers.get('Authorization')).toBe('Bearer tok-1');
    request.flush([]);
    expect(await result).toEqual([]);
  });

  it('does not try the home address when the server rejects the token', async () => {
    await setup();
    const result = api.getDays('2026-11-01', '2026-11-03');
    http.expectOne((r) => r.url.startsWith(REMOTE)).flush('x', { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ kind: 'unauthorized' });
    http.expectNone((r) => r.url.startsWith(HOME));
  });

  it('is offline when neither address answers', async () => {
    await setup();
    const result = api.getDays('2026-11-01', '2026-11-03');
    http.expectOne((r) => r.url.startsWith(REMOTE)).error(networkError());
    await tick();
    http.expectOne((r) => r.url.startsWith(HOME)).error(networkError());
    await expect(result).rejects.toMatchObject({ kind: 'offline' });
  });

  it('never leaves the HTTPS address when no home address is set', async () => {
    await setup('');
    const result = api.healthRoute();
    http.expectOne(`${REMOTE}/actuator/health`).error(networkError());
    expect(await result).toBeNull();
    http.expectNone((r) => r.url.startsWith('http://'));
  });
});
