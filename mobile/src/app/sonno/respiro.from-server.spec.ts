import { DayView, MetricView } from '../api/api.model';
import { respiroFromServer } from './respiro.from-server';
import { RESPIRO_SAMPLE } from './respiro.sample';

function night(date: string, spo2: { value: number | null; detail: unknown } | null, median?: number, baseline?: number): DayView {
  const metrics: Record<string, MetricView> = spo2
    ? { spo2_night: { value: spo2.value, unit: '%', detail: spo2.detail, algoVersion: 'v1' } }
    : {};
  return {
    day: date,
    scores: {},
    metrics,
    baselines: {},
    features: median === undefined ? {} : { spo2_median: median },
    references: baseline === undefined ? {} : { spo2_median: { median: baseline, deviation: 0 } },
  };
}

describe('respiroFromServer', () => {
  it('has nothing to show without an evaluated night', () => {
    expect(respiroFromServer(RESPIRO_SAMPLE, [])).toBeNull();
    expect(respiroFromServer(RESPIRO_SAMPLE, [night('2026-11-12', null)])).toBeNull();
    expect(respiroFromServer(RESPIRO_SAMPLE, [night('2026-11-12', { value: 96, detail: { status: 'boh' } })])).toBeNull();
  });

  it("translates the server's evaluation of the last night", () => {
    const days = [
      night('2026-11-10', { value: 96, detail: { status: 'ok', count: 30, streak: 0, min: 95 } }, 96, 96),
      night('2026-11-11', { value: 96, detail: { status: 'ok', count: 30, streak: 0, min: 95 } }, 96, 96),
      night('2026-11-12', { value: 93, detail: { status: 'watch', count: 42, streak: 3, min: 90, deviation: -2.4 } }, 93, 96),
    ];
    const data = respiroFromServer(RESPIRO_SAMPLE, days)!;
    expect(data.source).toBe('server');
    expect(data.result).toEqual({ status: 'watch', median: 93, min: 90, count: 42, deviation: -2.4, baseline: 96, streak: 3 });
  });

  it('builds the history from the nights before the last one, oldest first', () => {
    const days = [
      night('2026-11-10', { value: 96, detail: { status: 'ok', count: 30 } }, 96),
      night('2026-11-11', null),
      night('2026-11-12', { value: 97, detail: { status: 'ok', count: 30 } }, 97),
    ];
    expect(respiroFromServer(RESPIRO_SAMPLE, days)!.history).toEqual([96]);
  });

  it('shows «not enough data» with no median and no baseline', () => {
    const days = [night('2026-11-12', { value: null, detail: { status: 'insufficient', count: 6, streak: 0 } })];
    expect(respiroFromServer(RESPIRO_SAMPLE, days)!.result).toEqual({
      status: 'insufficient',
      median: null,
      min: null,
      count: 6,
      deviation: null,
      baseline: null,
      streak: 0,
    });
  });
});
