import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DaysService } from '../api/days.service';
import { DiarySyncService } from '../diary/diary-sync.service';
import { PluginsService } from '../plugins/plugins.service';
import { RingSyncService } from '../ring/ring-sync.service';
import { SyncAlertService } from '../ring/sync-alert.service';
import { BackgroundBridge, FakeBackgroundBridge } from '../ring/background/ring-background';
import { STARTUP_MAX_MS, STARTUP_MIN_MS, StartupSyncService } from './startup-sync.service';

type Work = () => Promise<void>;

describe('StartupSyncService', () => {
  function setup(
    options: { server?: boolean; ring?: boolean; background?: boolean; diary?: Work; days?: Work; plugins?: Work; ringSync?: Work } = {},
  ) {
    const { server = true, ring = false } = options;
    const bridge = new FakeBackgroundBridge();
    bridge.background = options.background ?? false;
    const diary = { connected: signal(server), sync: vi.fn(options.diary ?? (async () => undefined)) };
    const days = { refresh: vi.fn(options.days ?? (async () => undefined)) };
    const plugins = { refresh: vi.fn(options.plugins ?? (async () => undefined)) };
    const ringSync = {
      hasRing: signal(ring),
      active: signal(ring),
      sync: vi.fn(options.ringSync ?? (async () => undefined)),
      cancel: vi.fn(async () => undefined),
      step: signal<'ring' | 'upload' | null>(null),
      ringError: signal<string | null>(null),
      uploadError: signal<{ kind: string } | null>(null),
      settingsError: signal<string | null>(null),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DiarySyncService, useValue: diary },
        { provide: DaysService, useValue: days },
        { provide: PluginsService, useValue: plugins },
        { provide: RingSyncService, useValue: ringSync },
        { provide: BackgroundBridge, useValue: bridge },
      ],
    });
    return { service: TestBed.inject(StartupSyncService), diary, days, plugins, ringSync, bridge, alerts: TestBed.inject(SyncAlertService) };
  }

  it('does nothing and stays invisible without a server or a ring', async () => {
    const { service, diary, days, plugins, ringSync } = setup({ server: false, ring: false });
    await service.run();
    expect(service.visible()).toBe(false);
    expect(diary.sync).not.toHaveBeenCalled();
    expect(days.refresh).not.toHaveBeenCalled();
    expect(plugins.refresh).not.toHaveBeenCalled();
    expect(ringSync.sync).not.toHaveBeenCalled();
  });

  it('sends the diary, runs the ring sync and reloads days and plugins, showing the logo meanwhile', async () => {
    const { service, diary, days, plugins, ringSync } = setup();
    const running = service.run();
    expect(service.visible()).toBe(true);
    await running;
    expect(diary.sync).toHaveBeenCalledOnce();
    expect(ringSync.sync).toHaveBeenCalledOnce();
    expect(days.refresh).toHaveBeenCalledOnce();
    expect(plugins.refresh).toHaveBeenCalledOnce();
    expect(service.visible()).toBe(false);
  });

  it('reloads the results only after the ring data has been sent', async () => {
    const order: string[] = [];
    const { service } = setup({
      ringSync: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('ring');
      },
      days: async () => void order.push('days'),
    });
    await service.run();
    expect(order).toEqual(['ring', 'days']);
  });

  it('runs with a ring even without a server, and says so on the screen', async () => {
    const { service, ringSync } = setup({ server: false, ring: true });
    expect(service.label()).toContain("anello");
    await service.run();
    expect(ringSync.sync).toHaveBeenCalledOnce();
  });

  it('started by iOS in the background, waits for the foreground before reading the ring, with the logo already up', async () => {
    const { service, ringSync, diary } = setup({ ring: true, background: true });
    const running = service.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.visible()).toBe(true);
    expect(ringSync.sync).not.toHaveBeenCalled();
    expect(diary.sync).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('resume'));
    await running;
    expect(ringSync.sync).toHaveBeenCalledOnce();
    expect(service.visible()).toBe(false);
  });

  it('waits while the native collector reads with the app not yet active, then reads without a resume (docs/adr/0048)', async () => {
    const { service, ringSync, bridge } = setup({ ring: true, background: true });
    const running = service.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ringSync.sync).not.toHaveBeenCalled();
    bridge.background = false;
    await running;
    expect(ringSync.sync).toHaveBeenCalledOnce();
  });

  it('keeps the logo for a minimum time even when the work is instant', async () => {
    const { service } = setup();
    const started = Date.now();
    await service.run();
    expect(Date.now() - started).toBeGreaterThanOrEqual(STARTUP_MIN_MS - 50);
  });

  it('never fails when the server does', async () => {
    const { service } = setup({
      diary: async () => {
        throw new Error('rete');
      },
      days: async () => {
        throw new Error('rete');
      },
    });
    await expect(service.run()).resolves.toBeUndefined();
    expect(service.visible()).toBe(false);
  });

  it('opens the app at once on skip and cancels the sync: no download, no error window', async () => {
    let release: () => void = () => undefined;
    const ringDone = new Promise<void>((resolve) => (release = resolve));
    const { service, ringSync, days, plugins, alerts } = setup({ ring: true, ringSync: () => ringDone });
    ringSync.ringError.set("Non trovo l'anello.");
    const running = service.run();
    await new Promise((resolve) => setTimeout(resolve));
    service.skip();
    await running;
    expect(service.visible()).toBe(false);
    expect(ringSync.cancel).toHaveBeenCalledOnce();
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(days.refresh).not.toHaveBeenCalled();
    expect(plugins.refresh).not.toHaveBeenCalled();
    expect(alerts.problems()).toBeNull();
  });

  it('waits for a slow ring read instead of opening the app after a few seconds', async () => {
    expect(STARTUP_MAX_MS).toBeGreaterThanOrEqual(30000);
    let finished = false;
    const { service } = setup({
      ring: true,
      ringSync: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        finished = true;
      },
    });
    await service.run();
    expect(finished).toBe(true);
  });

  it('says which step it is at while it works', async () => {
    const { service, ringSync } = setup({ ring: true });
    ringSync.step.set('ring');
    expect(service.label()).toBe("Leggo l'anello…");
    ringSync.step.set('upload');
    expect(service.label()).toBe('Invio i dati al server di casa…');
  });

  it('opens an error dialog when the ring read failed, once the work is over', async () => {
    const { service, ringSync, alerts } = setup({ ring: true });
    ringSync.sync.mockImplementation(async () => {
      ringSync.ringError.set("L'anello non ha risposto in tempo. Riprova tra poco.");
    });
    await service.run();
    expect(alerts.problems()).toEqual(["L'anello non ha risposto in tempo. Riprova tra poco."]);
  });

  it('shows no dialog when everything went well', async () => {
    const { service, alerts } = setup({ ring: true });
    await service.run();
    expect(alerts.problems()).toBeNull();
  });
});
