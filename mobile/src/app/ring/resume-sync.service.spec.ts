import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Clock } from '../diary/clock';
import { FakeClock } from '../diary/testing';
import { OggiDataService } from '../oggi/oggi-data.service';
import { LiveSessionService, LiveStatus } from '../session/live-session.service';
import { SettingsService } from '../settings/settings.service';
import { StartupSyncService } from '../startup/startup-sync.service';
import { FullSyncService } from './full-sync.service';
import { RESUME_MIN_MS, ResumeSyncService } from './resume-sync.service';
import { RingSyncService } from './ring-sync.service';
import { HabitualCaffeineService } from '../diary/habitual-caffeine.service';

describe('ResumeSyncService', () => {
  function setup() {
    const clock = new FakeClock(new Date('2026-11-18T08:00:00Z'));
    const ring = { hasRing: signal(true), syncing: signal(false), lastStarted: signal<number | null>(null) };
    const fullSync = {
      run: vi.fn(async () => {
        ring.lastStarted.set(clock.now().getTime());
      }),
    };
    const live = { status: signal<LiveStatus>('idle') };
    const startup = { visible: signal(false) };
    const onboarded = signal(true);
    const oggi = { tick: vi.fn() };
    const habits = { apply: vi.fn(async () => 0) };
    TestBed.configureTestingModule({
      providers: [
        { provide: RingSyncService, useValue: ring },
        { provide: FullSyncService, useValue: fullSync },
        { provide: LiveSessionService, useValue: live },
        { provide: StartupSyncService, useValue: startup },
        { provide: SettingsService, useValue: { settings: () => ({ onboarded: onboarded() }) } },
        { provide: OggiDataService, useValue: oggi },
        { provide: HabitualCaffeineService, useValue: habits },
        { provide: Clock, useValue: clock },
      ],
    });
    return { service: TestBed.inject(ResumeSyncService), clock, ring, fullSync, live, startup, onboarded, oggi, habits };
  }

  it('adds the habitual caffeine on every return, even when the ring is not read', async () => {
    const { service, habits, ring } = setup();
    ring.hasRing.set(false);
    expect(await service.onResume()).toBe(false);
    expect(habits.apply).toHaveBeenCalledTimes(1);
  });

  it('reads the ring when the app comes back from the background', async () => {
    const { service, fullSync, oggi } = setup();
    service.listen();
    document.dispatchEvent(new Event('resume'));
    await vi.waitFor(() => expect(fullSync.run).toHaveBeenCalledTimes(1));
    expect(oggi.tick).toHaveBeenCalled();
  });

  it('waits 15 minutes from the start of the last sync', async () => {
    const { service, fullSync, clock, ring } = setup();
    ring.lastStarted.set(clock.now().getTime());
    clock.advanceMinutes(14);
    expect(await service.onResume()).toBe(false);
    clock.advanceMinutes(1);
    expect(await service.onResume()).toBe(true);
    expect(await service.onResume()).toBe(false);
    expect(fullSync.run).toHaveBeenCalledTimes(1);
    expect(RESUME_MIN_MS).toBe(15 * 60_000);
  });

  it('does not read without a ring, before the first setup, under the opening screen or during a sync', async () => {
    const { service, fullSync, ring, onboarded, startup } = setup();
    ring.hasRing.set(false);
    expect(await service.onResume()).toBe(false);
    ring.hasRing.set(true);
    onboarded.set(false);
    expect(await service.onResume()).toBe(false);
    onboarded.set(true);
    startup.visible.set(true);
    expect(await service.onResume()).toBe(false);
    startup.visible.set(false);
    ring.syncing.set(true);
    expect(await service.onResume()).toBe(false);
    expect(fullSync.run).not.toHaveBeenCalled();
  });

  it('never reads during a breathing or workout session', async () => {
    const { service, fullSync, live } = setup();
    for (const status of ['connecting', 'waiting', 'live'] as const) {
      live.status.set(status);
      expect(await service.onResume()).toBe(false);
    }
    live.status.set('ended');
    expect(await service.onResume()).toBe(true);
    expect(fullSync.run).toHaveBeenCalledTimes(1);
  });
});
