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
import { PluginView } from './plugin.model';
import { PLUGINS_CACHE_KEY, PluginsService } from './plugins.service';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';

const URL = 'https://ringlife.example.net';
const PLUGINS = `${URL}/api/v1/devices/dev-1/plugins`;

function view(id: string, overrides: Partial<PluginView> = {}): PluginView {
  return {
    manifest: { id, name: 'Report settimanale', description: '', version: '1', requires: [], config: [] },
    enabled: true,
    config: {},
    result: { cards: [{ type: 'score', title: 'Sonno', value: 80, zone: 'buono', caption: null }], insights: [] },
    ...overrides,
  };
}

describe('PluginsService', () => {
  let service: PluginsService;
  let http: HttpTestingController;
  let settings: SettingsService;

  async function setup(options: { paired?: boolean; serverUrl?: string } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SettingsRepository, useValue: new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, serverUrl: options.serverUrl ?? URL }) },
        { provide: CredentialsRepository, useValue: new InMemoryCredentialsRepository() },
      ],
    });
    service = TestBed.inject(PluginsService);
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(SettingsService);
    await settings.init();
    const credentials = TestBed.inject(CredentialsService);
    await credentials.init();
    if (options.paired !== false) {
      await credentials.savePaired({ deviceId: 'dev-1', token: 'tok-1' });
    }
  }

  afterEach(() => http.verify());

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

  it('splits the plugins into daily and weekly, and reads the headline', async () => {
    await setup();
    service.views.set([
      view('migraine', {
        manifest: { id: 'migraine', name: 'Emicrania', description: '', version: '3', requires: [], config: [], cadence: 'daily' },
        result: { cards: [{ type: 'text', title: null, body: 'x' }], insights: [], headline: { value: ' Rischio alto ', tone: 'attenzione' } },
      }),
      view('social-jetlag', {
        manifest: { id: 'social-jetlag', name: 'Jet lag sociale', description: '', version: '1', requires: [], config: [], cadence: 'weekly' },
        result: { cards: [{ type: 'text', title: null, body: 'x' }], insights: [], headline: { value: '1 h 10 più tardi', tone: 'boh' } },
      }),
      // Un server più vecchio: senza cadenza e senza sintesi, il plugin resta tra i quotidiani.
      view('weekly-report'),
    ]);
    expect(service.dailyGroups().map((g) => [g.id, g.headline])).toEqual([
      ['migraine', { value: 'Rischio alto', tone: 'attenzione' }],
      ['weekly-report', null],
    ]);
    expect(service.weeklyGroups().map((g) => [g.id, g.headline])).toEqual([['social-jetlag', { value: '1 h 10 più tardi', tone: null }]]);
  });

  it('keeps the downloaded plugins on the phone for the next opening without server (docs/adr/0043)', async () => {
    const store = new InMemoryKeyValueStore();
    TestBed.overrideProvider(PLAIN_STORE, { useValue: store });
    await setup();
    const refreshing = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report')]);
    await refreshing;
    expect(store.values.has(PLUGINS_CACHE_KEY)).toBe(true);

    service.views.set([]);
    await service.init();
    expect(service.views().map((v) => v.manifest.id)).toEqual(['weekly-report']);
  });

  it('asks nothing while the phone is not paired', async () => {
    await setup({ paired: false });
    await service.refresh();
    http.expectNone(PLUGINS);
    expect(service.groups()).toEqual([]);
  });

  it('shows the cards of an enabled plugin', async () => {
    await setup();
    const loading = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report')]);
    await loading;
    expect(service.groups()).toHaveLength(1);
    expect(service.groups()[0].cards[0]).toMatchObject({ type: 'score', title: 'Sonno' });
  });

  it('leaves out a plugin with no result yet and one the server has turned off', async () => {
    await setup();
    const loading = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report', { result: null })]);
    await loading;
    expect(service.groups()).toEqual([]);
  });

  it('leaves out the card types it does not know', async () => {
    await setup();
    const loading = service.refresh();
    http.expectOne(PLUGINS).flush([
      view('weekly-report', { result: { cards: [{ type: 'hologram' }], insights: [] } }),
    ]);
    await loading;
    expect(service.groups()).toEqual([]);
  });

  it('keeps the phone choice: a plugin turned off here is hidden and the server is told', async () => {
    await setup();
    await settings.setPlugin('weekly-report', false);
    const loading = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report')]);
    await tick();
    const put = http.expectOne(`${PLUGINS}/weekly-report`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ enabled: false });
    put.flush(view('weekly-report', { enabled: false, result: null }));
    await loading;
    expect(service.groups()).toEqual([]);
  });

  it('pushes a toggle to the server and uses its answer', async () => {
    await setup();
    const loading = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report', { enabled: false, result: null })]);
    await tick();
    // Il telefono ha il plugin acceso: il server si allinea.
    http.expectOne(`${PLUGINS}/weekly-report`).flush(view('weekly-report'));
    await loading;
    expect(service.groups()).toHaveLength(1);

    await settings.setPlugin('weekly-report', false);
    const pushing = service.pushEnabled('weekly-report', false);
    http.expectOne(`${PLUGINS}/weekly-report`).flush(view('weekly-report', { enabled: false, result: null }));
    await pushing;
    expect(service.groups()).toEqual([]);
  });

  it('keeps showing what it has when the server does not answer', async () => {
    await setup();
    let loading = service.refresh();
    http.expectOne(PLUGINS).flush([view('weekly-report')]);
    await loading;
    loading = service.refresh();
    http.expectOne(PLUGINS).error(new ProgressEvent('error'));
    await loading;
    expect(service.groups()).toHaveLength(1);
  });

  it('does not call the server for a toggle before the plugins were ever read', async () => {
    await setup();
    await service.pushEnabled('weekly-report', false);
    http.expectNone(`${PLUGINS}/weekly-report`);
  });
});
