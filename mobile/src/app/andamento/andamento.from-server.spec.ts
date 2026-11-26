import { DayView } from '../api/api.model';
import { EMPTY_DETAILS, HeadacheEpisode } from '../diary/headache.model';
import { andamentoFromServer } from './andamento.from-server';
import { ANDAMENTO_SAMPLE } from './andamento.sample';

function day(
  n: number,
  parts: { sleep?: number; recovery?: number; hrv?: number; rhr?: number; temp?: number; steps?: number; byHour?: number[] } = {},
): DayView {
  const date = `2026-11-${String(n).padStart(2, '0')}`;
  const features: Record<string, number> = {};
  if (parts.sleep !== undefined) features['sleep_asleep_min'] = parts.sleep;
  if (parts.hrv !== undefined) features['hrv_night'] = parts.hrv;
  if (parts.rhr !== undefined) features['resting_hr'] = parts.rhr;
  if (parts.steps !== undefined) features['steps'] = parts.steps;
  return {
    day: date,
    scores: parts.recovery === undefined ? {} : { recovery: { value: parts.recovery, algoVersion: 'v1', components: [] } },
    metrics: parts.temp === undefined ? {} : { temp_deviation: { value: parts.temp, unit: 'C', detail: null, algoVersion: 'v1' } },
    baselines: {},
    features,
    stepsByHour: parts.byHour ?? null,
  };
}

function episode(startedAt: string): HeadacheEpisode {
  return {
    id: startedAt,
    startedAt,
    endedAt: null,
    intensity: 5,
    intensityLog: [],
    medicationAt: [],
    details: EMPTY_DETAILS,
    completedAt: null,
  };
}

const FULL = (n: number) => day(n, { sleep: 400 + n, recovery: 60 + n, hrv: 40 + n, rhr: 55, temp: 0.1, steps: 5000 + n });

describe('andamentoFromServer', () => {
  it('has nothing to show without a night of sleep', () => {
    expect(andamentoFromServer(ANDAMENTO_SAMPLE, [], [])).toBeNull();
    expect(andamentoFromServer(ANDAMENTO_SAMPLE, [day(1, { steps: 100 })], [])).toBeNull();
  });

  it('uses the last day with a night as «today» and says the data come from the server', () => {
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(10), FULL(11), day(12, { steps: 30 })], [])!;
    expect(result.today.getDate()).toBe(11);
    expect(result.source).toBe('server');
  });

  it('builds each series from consecutive days ending today, oldest first', () => {
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(9), FULL(10), FULL(11)], [])!;
    expect(result.sleepMinutes).toEqual([409, 410, 411]);
    expect(result.hrv).toEqual([49, 50, 51]);
    expect(result.restingHr).toEqual([55, 55, 55]);
    expect(result.temperature).toEqual([0.1, 0.1, 0.1]);
    expect(result.recovery).toEqual([69, 70, 71]);
  });

  it('keeps the resting heart rate of the last 14 days for the cardio age, skipping nights without it', () => {
    const days = [day(1, { sleep: 400, rhr: 90 }), ...Array.from({ length: 14 }, (_, i) => day(i + 2, { sleep: 400, rhr: i === 5 ? undefined : 50 + i }))];
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, days, [])!;
    expect(result.restingHrRecent).toHaveLength(13);
    expect(result.restingHrRecent).not.toContain(90);
    expect(result.restingHr).toHaveLength(8);
  });

  it('stops a series at the first day without a value, so dates under the chart stay right', () => {
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(8), day(9, { sleep: 400 }), FULL(10), FULL(11)], [])!;
    expect(result.recovery).toEqual([70, 71]);
    expect(result.sleepMinutes).toEqual([408, 400, 410, 411]);
  });

  it('keeps a series empty when today has no value for it, instead of inventing one', () => {
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(10), day(11, { sleep: 400 })], [])!;
    expect(result.hrv).toEqual([]);
    expect(result.recovery).toEqual([]);
  });

  it('ends the steps yesterday, as the example does', () => {
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(9), FULL(10), FULL(11)], [])!;
    expect(result.steps).toEqual([5009, 5010]);
  });

  it("takes yesterday's steps by hour, or zeros when the server has none", () => {
    const byHour = Array.from({ length: 24 }, (_, h) => h);
    expect(andamentoFromServer(ANDAMENTO_SAMPLE, [day(10, { byHour }), FULL(11)], [])!.stepsYesterdayByHour).toEqual(byHour);
    expect(andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(10), FULL(11)], [])!.stepsYesterdayByHour).toEqual(Array(24).fill(0));
  });

  it('does not count headaches before the first day the server has data', () => {
    const empty = { ...day(8), features: {} };
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [empty, { ...day(9), features: {} }, FULL(10), FULL(11)], [])!;
    expect(result.headaches).toEqual([0, 0]);
  });

  it('counts headaches from the diary on the right local day, one number per day', () => {
    const episodes = [
      episode('2026-11-10T08:00:00Z'),
      episode('2026-11-10T21:00:00Z'),
      // Le 23:30 UTC del 10 sono le 00:30 dell'11 a Roma.
      episode('2026-11-10T23:30:00Z'),
    ];
    const result = andamentoFromServer(ANDAMENTO_SAMPLE, [FULL(9), FULL(10), FULL(11)], episodes)!;
    expect(result.headaches).toEqual([0, 2, 1]);
  });
});
