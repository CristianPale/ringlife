import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LiveSessionService, LiveStatus } from '../session/live-session.service';
import { CHARGING_POLL_MS, ChargingMonitorService } from './charging-monitor.service';
import { RingSyncService } from './ring-sync.service';

describe('ChargingMonitorService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const ring = { charging: signal(false), refreshBattery: vi.fn(async () => true) };
    const live = { status: signal<LiveStatus>('idle') };
    TestBed.configureTestingModule({
      providers: [
        { provide: RingSyncService, useValue: ring },
        { provide: LiveSessionService, useValue: live },
      ],
    });
    const monitor = TestBed.inject(ChargingMonitorService);
    TestBed.tick();
    return { monitor, ring, live };
  }

  async function minutes(n: number): Promise<void> {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(n * CHARGING_POLL_MS);
  }

  it('reads the battery once a minute while the ring is charging', async () => {
    const { ring } = setup();
    await minutes(2);
    expect(ring.refreshBattery).not.toHaveBeenCalled();
    ring.charging.set(true);
    await minutes(3);
    expect(ring.refreshBattery).toHaveBeenCalledTimes(3);
  });

  it('stops when the ring leaves the charger', async () => {
    const { ring } = setup();
    ring.charging.set(true);
    await minutes(1);
    ring.charging.set(false);
    await minutes(5);
    expect(ring.refreshBattery).toHaveBeenCalledTimes(1);
  });

  it('stops in the background and starts again on return', async () => {
    const { ring } = setup();
    ring.charging.set(true);
    document.dispatchEvent(new Event('pause'));
    await minutes(5);
    expect(ring.refreshBattery).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('resume'));
    await minutes(1);
    expect(ring.refreshBattery).toHaveBeenCalledTimes(1);
  });

  it('never reads during a breathing or workout session', async () => {
    const { monitor, ring, live } = setup();
    for (const status of ['connecting', 'waiting', 'live'] as const) {
      live.status.set(status);
      expect(await monitor.poll()).toBe(false);
    }
    expect(ring.refreshBattery).not.toHaveBeenCalled();
    live.status.set('ended');
    expect(await monitor.poll()).toBe(true);
  });
});
