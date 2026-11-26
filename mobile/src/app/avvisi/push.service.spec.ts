import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CredentialsService } from '../api/credentials.service';
import { PLAIN_STORE } from '../api/key-value-store';
import { RingLifeApi } from '../api/ringlife-api';
import { InMemoryKeyValueStore } from '../api/testing';
import { BackgroundBridge, FakeBackgroundBridge } from '../ring/background/ring-background';
import { SettingsService } from '../settings/settings.service';
import { PushStatus } from './push.model';
import { PUSH_STORE_KEY, PushService, pushText } from './push.service';

const READY: PushStatus = { registered: true, serverReady: true, environment: 'production', lastSentAt: null, lastError: null };

describe('PushService (docs/adr/0047)', () => {
  function setup(store = new InMemoryKeyValueStore()) {
    TestBed.resetTestingModule();
    const api = {
      offline: false,
      setPush: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
        return READY;
      }),
      deletePush: vi.fn(async () => {
        if (api.offline) throw new Error('offline');
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
      ],
    });
    return { service: TestBed.inject(PushService), api, bridge, store };
  }

  it('says why it cannot turn on without the Apple setup, and sends nothing', async () => {
    const { service, api, bridge } = setup();
    bridge.push = { ok: false, reason: 'not_configured' };
    await service.enable();
    expect(service.enabled()).toBe(false);
    expect(service.problem()).toBe('not_configured');
    expect(api.setPush).not.toHaveBeenCalled();
  });

  it('registers token and key on the server, remembers it, and registers again at every opening', async () => {
    const { service, api, bridge, store } = setup();
    bridge.push = { ok: true, token: 'ab'.repeat(32), key: 'a2V5', environment: 'production' };
    await service.enable();
    expect(api.setPush).toHaveBeenCalledWith({ token: 'ab'.repeat(32), key: 'a2V5', environment: 'production' });
    expect(service.enabled()).toBe(true);
    expect(store.values.has(PUSH_STORE_KEY)).toBe(true);

    const again = setup(store);
    again.bridge.push = { ok: true, token: 'cd'.repeat(32), key: 'a2V5', environment: 'production' };
    await again.service.init();
    await again.service.ensure();
    expect(again.api.setPush).toHaveBeenCalledWith({ token: 'cd'.repeat(32), key: 'a2V5', environment: 'production' });
  });

  it('turns off on the server first, then removes the key from the phone', async () => {
    const { service, api, bridge } = setup();
    bridge.push = { ok: true, token: 'ab'.repeat(32), key: 'a2V5', environment: 'production' };
    await service.enable();
    api.offline = true;
    await service.disable();
    expect(service.enabled()).toBe(true);
    expect(bridge.pushUnregistered).toBe(0);
    api.offline = false;
    await service.disable();
    expect(service.enabled()).toBe(false);
    expect(bridge.pushUnregistered).toBe(1);
  });

  it('describes the state in words', () => {
    expect(pushText(false, null, null)).toContain('Spente');
    expect(pushText(true, READY, null)).toContain('Attive');
    expect(pushText(true, { ...READY, serverReady: false }, null)).toContain('chiave di Apple');
    expect(pushText(true, { ...READY, lastError: 'BadTopic' }, null)).toContain('Ultimo invio non riuscito: BadTopic.');
    expect(pushText(false, null, 'denied')).toContain("Impostazioni dell'iPhone");
  });
});
