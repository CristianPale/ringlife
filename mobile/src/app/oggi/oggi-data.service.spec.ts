import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CredentialsRepository } from '../api/credentials.repository';
import { CredentialsService } from '../api/credentials.service';
import { InMemoryCredentialsRepository } from '../api/testing';
import { DEFAULT_SETTINGS } from '../settings/settings.model';
import { SettingsRepository } from '../settings/settings.repository';
import { SettingsService } from '../settings/settings.service';
import { InMemorySettingsRepository } from '../settings/testing';
import { localDayKey } from '../api/days.service';
import { OggiDataService } from './oggi-data.service';
import { OGGI_SAMPLE } from './oggi.sample';

const URL = 'https://ringlife.example.net';
const NOW = new Date('2026-11-12T11:00:00Z');

describe('localDayKey', () => {
  it('gives the local day for the phone offset', () => {
    expect(localDayKey(NOW, 60)).toBe('2026-11-12');
    expect(localDayKey(NOW, 60, 6)).toBe('2026-11-06');
    expect(localDayKey(new Date('2026-11-12T23:30:00Z'), 60)).toBe('2026-11-13');
  });
});

describe('OggiDataService', () => {
  async function setup(paired: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: URL }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    });
    await TestBed.inject(SettingsService).init();
    const credentials = TestBed.inject(CredentialsService);
    await credentials.init();
    if (paired) {
      await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    }
    return { service: TestBed.inject(OggiDataService), http: TestBed.inject(HttpTestingController) };
  }

  const dayOf = (day: string, value: number, deviation: number | null = null) => ({
    day,
    scores: { recovery: { value, algoVersion: 'v1', components: [] } },
    metrics: {},
    baselines: {},
    ...(deviation === null ? {} : { scoreReferences: { recovery: { median: 80, spread: 5, deviation } } }),
  });

  it('shows the example data and asks nothing while the phone is not paired', async () => {
    const { service, http } = await setup(false);
    await service.refresh(NOW);
    expect(service.data()).toBe(OGGI_SAMPLE);
    expect(service.source()).toBe('esempio');
    http.verify();
  });

  it('asks for the last ninety days and shows what the server calculated', async () => {
    const { service, http } = await setup(true);
    const done = service.refresh(NOW);
    const request = http.expectOne((r) => r.url === `${URL}/api/v1/devices/dev-1/days`);
    expect(request.request.params.get('from')).toBe('2026-08-15');
    expect(request.request.params.get('to')).toBe('2026-11-12');
    request.flush([dayOf('2026-11-11', 70), dayOf('2026-11-12', 91, 1.2)]);
    await done;
    expect(service.source()).toBe('server');
    expect(service.data().recupero!.value).toBe(91);
    expect(service.data().recupero!.deviation).toBe(1.2);
  });

  it('shows empty rows, not the example, when a connected server has no data yet', async () => {
    const { service, http } = await setup(true);
    const done = service.refresh(NOW);
    http.expectOne((r) => r.url.endsWith('/days')).flush([]);
    await done;
    expect(service.data()).not.toBe(OGGI_SAMPLE);
    expect(service.data().stress).toBeNull();
    expect(service.data().recupero).toBeNull();
    expect(service.source()).toBe('server');
  });

  it('does not wipe what it shows when the network fails', async () => {
    const { service, http } = await setup(true);
    let done = service.refresh(NOW);
    http.expectOne((r) => r.url.endsWith('/days')).flush([dayOf('2026-11-12', 91)]);
    await done;
    done = service.refresh(NOW);
    http.expectOne((r) => r.url.endsWith('/days')).error(new ProgressEvent('error'));
    await done;
    expect(service.data().recupero!.value).toBe(91);
    expect(service.source()).toBe('server');
  });
});
