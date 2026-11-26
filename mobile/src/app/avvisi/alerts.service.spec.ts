import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CredentialsService } from '../api/credentials.service';
import { DaysService } from '../api/days.service';
import { PLAIN_STORE } from '../api/key-value-store';
import { RingLifeApi } from '../api/ringlife-api';
import { InMemoryKeyValueStore } from '../api/testing';
import { BackgroundBridge, FakeBackgroundBridge } from '../ring/background/ring-background';
import { RingSyncService } from '../ring/ring-sync.service';
import { SettingsService } from '../settings/settings.service';
import { AlertEvent, AlertsConfig } from './alerts.model';
import { ALERTS_CACHE_KEY, AlertsService, serviceAlertsOf } from './alerts.service';

const DAY = 86_400_000;
const CONFIG: AlertsConfig = {
  settings: { quietStart: '22:30', quietEnd: '07:00', lockScreen: 'breve', homeAssistant: false },
  rules: [],
  custom: [
    {
      id: 'custom-0a1b2c3d',
      name: 'Passi sotto 3.000',
      metric: 'steps',
      comparison: 'below',
      amount: 3000,
      days: 1,
      level: 'attenzione',
      delivery: 'elenco',
      enabled: true,
    },
  ],
};

function event(id: string): AlertEvent {
  return { id, rule: 'hrv', day: '2026-11-24', level: 'attenzione', title: `T ${id}`, body: 'B', route: null, createdAt: Number(id.slice(1)), deliverAfter: null, seenAt: null };
}

describe('AlertsService', () => {
  function setup(store = new InMemoryKeyValueStore()) {
    TestBed.resetTestingModule();
    const api = {
      events: [] as AlertEvent[],
      offline: false,
      getAlerts: vi.fn(async function (this: void) {
        if (api.offline) throw new Error('offline');
        return { events: api.events, unseen: api.events.length };
      }),
      getAlertsConfig: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
        return CONFIG;
      }),
      setAlertsConfig: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
        return CONFIG;
      }),
      markAlertsSeen: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
      }),
      createCustomAlert: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
        return CONFIG;
      }),
    };
    const bridge = new FakeBackgroundBridge();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLAIN_STORE, useValue: store },
        { provide: RingLifeApi, useValue: api },
        { provide: BackgroundBridge, useValue: bridge },
        { provide: CredentialsService, useValue: { paired: signal({ deviceId: 'dev-1', token: 't' }) } },
        { provide: SettingsService, useValue: { settings: signal({ serverUrl: 'https://casa.example' }) } },
        { provide: RingSyncService, useValue: { oldestPending: signal(null) } },
        { provide: DaysService, useValue: { reachable: signal(true), fetchedAt: signal(null) } },
      ],
    });
    return { service: TestBed.inject(AlertsService), api, bridge, store };
  }

  it('lists the old alerts the first time without a burst of notifications, then notifies only the new ones', async () => {
    const { service, api, bridge, store } = setup();
    api.events = [event('e1'), event('e2')];
    await service.refresh(new Date(2026, 10, 24, 9));
    expect(service.events().map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(bridge.notifications).toEqual([]);

    api.events = [event('e1'), event('e2'), event('e3')];
    await service.refresh(new Date(2026, 10, 24, 10));
    expect(bridge.notifications).toHaveLength(1);
    expect(bridge.notifications[0]).toMatchObject({ id: 'alert-e3', title: 'T e3' });

    // Alla riapertura gli stessi avvisi non si notificano di nuovo.
    const again = setup(store);
    await again.service.init();
    again.api.events = [event('e1'), event('e2'), event('e3')];
    await again.service.refresh(new Date(2026, 10, 24, 11));
    expect(again.bridge.notifications).toEqual([]);
    expect(store.values.has(ALERTS_CACHE_KEY)).toBe(true);
  });

  it("follows the delivery of a custom rule: «Solo nell'elenco» never notifies (docs/adr/0046)", async () => {
    const { service, api, bridge } = setup();
    await service.refresh(new Date(2026, 10, 24, 9));
    api.events = [{ ...event('e5'), rule: 'custom-0a1b2c3d' }];
    await service.refresh(new Date(2026, 10, 24, 10));
    expect(service.events()).toHaveLength(1);
    expect(bridge.notifications).toEqual([]);
  });

  it('creates a custom rule only with the server', async () => {
    const { service, api } = setup();
    const draft = { metric: 'steps', comparison: 'below' as const, amount: 3000, days: 3, level: 'attenzione' as const, delivery: 'notifica' as const, enabled: true };
    api.offline = true;
    expect(await service.addCustom(draft)).toBe(false);
    api.offline = false;
    expect(await service.addCustom(draft)).toBe(true);
    expect(service.config()?.custom).toHaveLength(1);
  });

  it('marks everything seen, also without server, and sends it at the next refresh', async () => {
    const { service, api } = setup();
    api.events = [event('e1')];
    await service.refresh();
    expect(service.unseen()).toBe(1);
    api.offline = true;
    await service.markAllSeen();
    expect(service.unseen()).toBe(0);
    api.offline = false;
    api.markAlertsSeen.mockClear();
    await service.refresh();
    expect(api.markAlertsSeen).toHaveBeenCalledWith('all');
  });

  it('does not pretend to save the configuration without server', async () => {
    const { service, api } = setup();
    api.offline = true;
    expect(await service.saveConfig({ settings: { quietStart: '23:00' } })).toBe(false);
    api.offline = false;
    expect(await service.saveConfig({ settings: { quietStart: '23:00' } })).toBe(true);
  });

  it('adds the service alerts of the phone: data not sent for 3 days, server unreachable for 2', () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    expect(serviceAlertsOf(null, true, now, now)).toEqual([]);
    const alerts = serviceAlertsOf(now - 4 * DAY, false, now - 2 * DAY, now);
    expect(alerts.map((a) => [a.id, a.title])).toEqual([
      ['queue-stuck', "Dati dell'anello non inviati da 4 giorni"],
      ['server-unreachable', 'Server di casa non raggiungibile da 2 giorni'],
    ]);
    expect(serviceAlertsOf(now - DAY, false, now - DAY, now)).toEqual([]);
  });
});
