import { DayView } from '../api/api.model';
import { gapFor, heartToday, restingAverage, segments } from './heart-today';

describe('heart today', () => {
  const NOW = Date.parse('2026-11-22T14:00:00Z'); // 15:00 a Roma
  const min = 60_000;

  it('keeps the readings of the Rome day up to now, with the last, lowest and highest', () => {
    const readings = [
      { ts: Date.parse('2026-11-21T22:30:00Z'), bpm: 50 }, // 23:30 di ieri a Roma
      { ts: Date.parse('2026-11-21T23:05:00Z'), bpm: 55 }, // 00:05 di oggi a Roma
      { ts: NOW - 30 * min, bpm: 88 },
      { ts: NOW - 5 * min, bpm: 70 },
      { ts: NOW + 5 * min, bpm: 99 },
    ];
    const today = heartToday(readings, NOW)!;
    expect(today.points).toEqual([
      { min: 5, bpm: 55 },
      { min: 14 * 60 + 30, bpm: 88 },
      { min: 14 * 60 + 55, bpm: 70 },
    ]);
    expect(today.last.bpm).toBe(70);
    expect(today.low.bpm).toBe(55);
    expect(today.high.bpm).toBe(88);
    expect(heartToday([], NOW)).toBeNull();
  });

  it('breaks the line where the ring did not measure', () => {
    const points = [0, 5, 10, 60, 65, 200].map((m) => ({ min: m, bpm: 60 }));
    expect(segments(points, 20).map((s) => s.map((p) => p.min))).toEqual([[0, 5, 10], [60, 65], [200]]);
    expect(gapFor(5)).toBe(20);
    expect(gapFor(30)).toBe(90);
  });

  it('takes your resting heart rate from the last day that has it', () => {
    const day = (key: string, median?: number): DayView => ({
      day: key,
      scores: {},
      metrics: {},
      baselines: {},
      references: median === undefined ? {} : { resting_hr: { median, deviation: 0 } },
    });
    expect(restingAverage([day('2026-11-20', 54), day('2026-11-21', 55), day('2026-11-22')])).toBe(55);
    expect(restingAverage([day('2026-11-22')])).toBeNull();
  });
});
