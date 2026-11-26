import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RingSyncService } from '../ring/ring-sync.service';
import { RingSourceProvider } from '../ring/ring-source.provider';
import { RingError } from '../ring/ring-source';
import { LiveSessionService } from './live-session.service';
import { SessionHistoryService } from './session-history.service';

describe('LiveSessionService', () => {
  function setup(options: { syncing?: boolean; fail?: boolean } = {}) {
    let listener: (bpm: number | null) => void = () => undefined;
    const stop = vi.fn(async () => undefined);
    const pause = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const source = {
      startLiveHeartRate: vi.fn(async (l: (bpm: number | null) => void) => {
        if (options.fail) {
          throw new RingError('ring_not_found');
        }
        listener = l;
        return { stop, pause, resume };
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: RingSourceProvider, useValue: { current: signal(source) } },
        { provide: RingSyncService, useValue: { busy: signal(options.syncing ?? false) } },
      ],
    });
    return { live: TestBed.inject(LiveSessionService), send: (v: number | null) => listener(v), stop, pause, resume, source };
  }

  it('waits for the lock, then collects the heart rate', async () => {
    const { live, send } = setup();
    let clock = 1_000;
    await live.start('allenamento', () => clock);
    expect(live.status()).toBe('waiting');
    send(null);
    expect(live.status()).toBe('waiting');
    clock = 16_000;
    send(72);
    clock = 17_000;
    send(70);
    expect(live.status()).toBe('live');
    expect(live.bpm()).toBe(70);
    expect(live.samples()).toEqual([
      { t: 15_000, bpm: 72 },
      { t: 16_000, bpm: 70 },
    ]);
  });

  it('stops the ring session and ends', async () => {
    const { live, send, stop } = setup();
    await live.start('allenamento', () => 0);
    send(70);
    await live.stop(() => 5_000);
    expect(stop).toHaveBeenCalledOnce();
    expect(live.status()).toBe('ended');
    expect(live.endedAt()).toBe(5_000);
    expect(TestBed.inject(SessionHistoryService).sessions()).toHaveLength(1);
    expect(live.savedId()).not.toBeNull();
    send(90);
    expect(live.samples()).toHaveLength(1);
  });

  it('in pause records no heart rate and stops the active time', async () => {
    const { live, send, pause, resume } = setup();
    let clock = 0;
    await live.start('allenamento', () => clock, { activity: 'corsa', targetZone: 3 });
    clock = 10_000;
    send(120);
    await live.pause(() => 20_000);
    expect(pause).toHaveBeenCalledOnce();
    expect(live.status()).toBe('paused');
    clock = 25_000;
    send(90);
    expect(live.samples()).toHaveLength(1);
    expect(live.activeMs(50_000)).toBe(20_000);
    await live.resume(() => 50_000);
    expect(resume).toHaveBeenCalledOnce();
    expect(live.status()).toBe('live');
    expect(live.activeMs(60_000)).toBe(30_000);
  });

  it('after Fine keeps measuring a minute for the recovery, then saves the training', async () => {
    vi.useFakeTimers();
    try {
      const { live, send, stop } = setup();
      let clock = 0;
      await live.start('allenamento', () => clock, { activity: 'corsa', targetZone: null });
      for (let t = 1_000; t <= 60_000; t += 1_000) {
        clock = t;
        send(150);
      }
      await live.finish(() => 60_000);
      expect(live.status()).toBe('recovering');
      expect(stop).not.toHaveBeenCalled();
      for (let t = 61_000; t <= 120_000; t += 1_000) {
        clock = t;
        send(t >= 110_000 ? 120 : 135);
      }
      expect(live.samples()).toHaveLength(60);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stop).toHaveBeenCalledOnce();
      expect(live.status()).toBe('ended');
      expect(live.recovery()).toEqual({ end: 150, after: 120 });
      const saved = TestBed.inject(SessionHistoryService).sessions()[0];
      expect(saved).toMatchObject({ mode: 'allenamento', activity: 'corsa', targetZone: null, durationMs: 60_000, recovery: { end: 150, after: 120 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the recovery when asked', async () => {
    const { live, send, stop } = setup();
    await live.start('allenamento', () => 0, { activity: 'camminata', targetZone: null });
    send(100);
    await live.finish(() => 5_000);
    await live.skipRecovery();
    expect(stop).toHaveBeenCalledOnce();
    expect(live.status()).toBe('ended');
    expect(live.recovery()).toBeNull();
  });

  it('ends the breathing session at once, without recovery', async () => {
    const { live, send, stop } = setup();
    await live.start('respirazione', () => 0);
    send(70);
    await live.finish(() => 5_000);
    expect(stop).toHaveBeenCalledOnce();
    expect(live.status()).toBe('ended');
    expect(TestBed.inject(SessionHistoryService).sessions()[0].activity).toBeUndefined();
  });

  it('never starts during a sync, and says why', async () => {
    const { live, source } = setup({ syncing: true });
    await live.start('allenamento');
    expect(source.startLiveHeartRate).not.toHaveBeenCalled();
    expect(live.status()).toBe('error');
    expect(live.error()).toContain('sincronizzando');
  });

  it('turns a ring error into a message', async () => {
    const { live } = setup({ fail: true });
    await live.start('allenamento');
    expect(live.status()).toBe('error');
    expect(live.error()).toContain("Non trovo l'anello");
  });
});
