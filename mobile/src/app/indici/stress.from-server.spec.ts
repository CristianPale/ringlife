import { DayView } from '../api/api.model';
import { stressFromServer } from './stress.from-server';
import { STRESS_SAMPLE } from './stress.sample';

interface Comp {
  id: string;
  weight: number;
  score: number | null;
}

const BOTH: Comp[] = [
  { id: 'stress-load', weight: 0.7, score: 88 },
  { id: 'stress-evening', weight: 0.3, score: 78 },
];

const HOURS = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 23 ? 30 + h : null));

function day(date: string, value: number | null, components: Comp[] = BOTH, extra: Partial<DayView> = {}): DayView {
  return {
    day: date,
    scores: value === null ? {} : { stress: { value, algoVersion: 'v1', components } },
    metrics: {},
    baselines: {},
    features: { stress_high_share: 0.12, stress_day_median: 41.6, stress_evening_median: 33.2, stress_samples: 32 },
    stressByHour: HOURS,
    ...extra,
  };
}

describe('stressFromServer', () => {
  it('has nothing to show without a calculated Stress', () => {
    expect(stressFromServer(STRESS_SAMPLE, [])).toBeNull();
    expect(stressFromServer(STRESS_SAMPLE, [day('2026-11-12', null)])).toBeNull();
  });

  it('takes value, zone, date and source from the last day that has the index', () => {
    const result = stressFromServer(STRESS_SAMPLE, [day('2026-11-10', 60), day('2026-11-11', 90), day('2026-11-12', null)])!;
    expect(result.value).toBe(90);
    expect(result.zone).toBe('ottimo');
    expect(result.source).toBe('server');
    expect(result.date.getDate()).toBe(11);
  });

  it('writes the two signals with numbers from the day', () => {
    const [load, evening] = stressFromServer(STRESS_SAMPLE, [day('2026-11-11', 85)])!.signals;
    expect(load.id).toBe('stress-load');
    expect(load.label).toBe('Tempo in stress alto');
    expect(load.valueText).toBe('12% del tempo');
    expect(evening.valueText).toBe('giorno 42 · sera 33');
    expect(evening.baselineText).toBe('Più basso la sera è meglio');
    expect(load.help.length).toBeGreaterThan(20);
  });

  it('shows only the score when the server does not send the numbers', () => {
    const bare = day('2026-11-11', 85, BOTH, { features: {} });
    const result = stressFromServer(STRESS_SAMPLE, [bare])!;
    expect(result.signals.map((s) => s.valueText)).toEqual(['88 su 100', '78 su 100']);
    expect(result.highShare).toBeNull();
  });

  it('drops the evening signal when the server had no evening data and rescales the weight', () => {
    const onlyLoad: Comp[] = [BOTH[0], { id: 'stress-evening', weight: 0.3, score: null }];
    const result = stressFromServer(STRESS_SAMPLE, [day('2026-11-11', 88, onlyLoad)])!;
    expect(result.signals.map((s) => s.id)).toEqual(['stress-load']);
    expect(result.signals[0].weight).toBeCloseTo(1, 10);
  });

  it('passes the hour by hour profile, or an empty one when there is none', () => {
    expect(stressFromServer(STRESS_SAMPLE, [day('2026-11-11', 85)])!.byHour).toEqual(HOURS);
    const none = stressFromServer(STRESS_SAMPLE, [day('2026-11-11', 85, BOTH, { stressByHour: null })])!;
    expect(none.byHour).toHaveLength(24);
    expect(none.byHour.every((v) => v === null)).toBe(true);
  });

  it('builds the history from the days that have the index, oldest first', () => {
    const days = [day('2026-11-09', 70), day('2026-11-10', null), day('2026-11-11', 80)];
    expect(stressFromServer(STRESS_SAMPLE, days)!.history).toEqual([70, 80]);
  });

  it('ignores unknown components and works with a score without a component list', () => {
    const odd: Comp[] = [...BOTH, { id: 'novità', weight: 0.5, score: 10 }];
    expect(stressFromServer(STRESS_SAMPLE, [day('2026-11-11', 85, odd)])!.signals).toHaveLength(2);
    const broken = day('2026-11-11', 85);
    broken.scores['stress'].components = null;
    expect(stressFromServer(STRESS_SAMPLE, [broken])!.signals).toEqual([]);
  });
});
