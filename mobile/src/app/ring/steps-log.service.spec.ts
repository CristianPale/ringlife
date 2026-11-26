import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { STEPS_KEEP_MS, StepsLogService, stepsOfDay } from './steps-log.service';

describe('StepsLogService', () => {
  it('keeps one value per interval, the last one read, and only the last 48 hours', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLAIN_STORE, useValue: new InMemoryKeyValueStore() }],
    });
    const log = TestBed.inject(StepsLogService);
    const now = Date.parse('2026-11-24T12:00:00Z');
    await log.add(
      [
        { metric: 'STEPS', ts: now - STEPS_KEEP_MS - 1, value: 999 },
        { metric: 'STEPS', ts: now - 3_600_000, value: 200 },
        { metric: 'HR', ts: now - 3_600_000, value: 70 },
      ],
      now,
    );
    // L'ora in corso si rilegge: lo stesso istante con più passi prende il posto del primo.
    await log.add([{ metric: 'STEPS', ts: now - 3_600_000, value: 350 }], now);
    expect(log.readings()).toEqual([{ ts: now - 3_600_000, steps: 350 }]);
  });

  it('adds up the steps of a day in Rome', () => {
    const readings = [
      { ts: Date.parse('2026-11-23T22:30:00Z'), steps: 100 }, // 23:30 del 23 a Roma
      { ts: Date.parse('2026-11-23T23:15:00Z'), steps: 40 }, // 00:15 del 24 a Roma
      { ts: Date.parse('2026-11-24T09:00:00Z'), steps: 1200 },
    ];
    expect(stepsOfDay(readings, '2026-11-24')).toBe(1240);
    expect(stepsOfDay(readings, '2026-11-22')).toBeNull();
  });
});
