import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AlertsService } from '../../avvisi/alerts.service';
import { RingSyncService } from '../ring-sync.service';
import { BackgroundBridge, FakeBackgroundBridge } from './ring-background';
import { BackgroundChainService } from './background-chain.service';

describe('BackgroundChainService (docs/adr/0048)', () => {
  function setup(options: { background?: boolean; busy?: boolean; sent?: boolean; fails?: boolean } = {}) {
    TestBed.resetTestingModule();
    const bridge = new FakeBackgroundBridge();
    bridge.background = options.background ?? true;
    const ring = {
      busy: signal(options.busy ?? false),
      backgroundChain: vi.fn(async (report: (step: 'decoded' | 'uploaded') => Promise<void>) => {
        if (options.fails) {
          throw new Error('boom');
        }
        await report('decoded');
        if (options.sent === false) {
          return false;
        }
        await report('uploaded');
        return true;
      }),
    };
    const alerts = { refresh: vi.fn(async () => undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: BackgroundBridge, useValue: bridge },
        { provide: RingSyncService, useValue: ring },
        { provide: AlertsService, useValue: alerts },
      ],
    });
    const service = TestBed.inject(BackgroundChainService);
    service.start();
    return { bridge, ring, alerts, service };
  }

  async function fire(bridge: FakeBackgroundBridge): Promise<void> {
    bridge.backgroundRead!('background');
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('decodes, uploads, asks for the alerts and tells the native side each step', async () => {
    const { bridge, alerts } = setup();
    await fire(bridge);
    expect(bridge.steps).toEqual(['started', 'decoded', 'uploaded', 'alerts']);
    expect(alerts.refresh).toHaveBeenCalled();
  });

  it('stops after decoding when the server does not answer', async () => {
    const { bridge, alerts } = setup({ sent: false });
    await fire(bridge);
    expect(bridge.steps).toEqual(['started', 'decoded', 'stop']);
    expect(alerts.refresh).not.toHaveBeenCalled();
  });

  it('leaves the work to the app in the foreground or while the ring is busy', async () => {
    const foreground = setup({ background: false });
    await fire(foreground.bridge);
    expect(foreground.bridge.steps).toEqual(['started', 'skipped']);
    expect(foreground.ring.backgroundChain).not.toHaveBeenCalled();

    const busy = setup({ busy: true });
    await fire(busy.bridge);
    expect(busy.bridge.steps).toEqual(['started', 'skipped']);
  });

  it('reports a failure instead of hanging', async () => {
    const { bridge } = setup({ fails: true });
    await fire(bridge);
    expect(bridge.steps).toEqual(['started', 'failed']);
  });
});
