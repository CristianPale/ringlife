import { DayView } from '../api/api.model';
import { segmentsFrom, sonnoFromServer } from './sonno.from-server';
import { SONNO_SAMPLE } from './sonno.sample';

const MIN = 60_000;
// 11 novembre 2026, 23:30 a Roma.
const START = Date.parse('2026-11-11T22:30:00Z');

type Stage = 'awake' | 'light' | 'deep' | 'rem';

function sleep(parts: [Stage, number][], gapBefore: number[] = []): NonNullable<DayView['sleep']> {
  let cursor = START;
  const stages = parts.map(([stage, minutes], i) => {
    cursor += (gapBefore[i] ?? 0) * MIN;
    const item = { stage, start: cursor, end: cursor + minutes * MIN };
    cursor = item.end;
    return item;
  });
  return { start: START, end: cursor, stages };
}

const NIGHT = sleep([['awake', 10], ['light', 120], ['deep', 70], ['light', 60], ['rem', 50], ['awake', 5], ['light', 135]]);

const COMPONENTS = [
  { id: 'sleep-duration', weight: 0.3, score: 90 },
  { id: 'sleep-efficiency', weight: 0.15, score: 96 },
  { id: 'sleep-deep', weight: 0.15, score: 80 },
  { id: 'sleep-rem', weight: 0.15, score: 60 },
  { id: 'sleep-awakenings', weight: 0.1, score: 85 },
  { id: 'sleep-regularity', weight: 0.1, score: null },
  { id: 'sleep-min-hr', weight: 0.05, score: 75 },
];

function day(date: string, extra: Partial<DayView> = {}, value = 82): DayView {
  return {
    day: date,
    scores: { sleep: { value, algoVersion: 'v1', components: COMPONENTS } },
    metrics: { sleep_debt: { value: 2.5, unit: 'h', detail: null, algoVersion: 'v1' } },
    baselines: {},
    features: { sleep_awakenings: 1, min_hr: 52.4 },
    references: { min_hr: { median: 54, deviation: -0.5 } },
    sleep: NIGHT,
    ...extra,
  };
}

describe('segmentsFrom', () => {
  it('counts minutes from going to bed, in order', () => {
    const segments = segmentsFrom(NIGHT);
    expect(segments[0]).toEqual({ stage: 'awake', startMin: 0, durationMin: 10 });
    expect(segments[1]).toEqual({ stage: 'light', startMin: 10, durationMin: 120 });
    expect(segments.reduce((sum, s) => sum + s.durationMin, 0)).toBe(450);
  });

  it('counts a gap between two stages as awake, so the night keeps its length', () => {
    const gappy = sleep([['light', 60], ['deep', 60]], [0, 15]);
    const segments = segmentsFrom(gappy);
    expect(segments.map((s) => s.stage)).toEqual(['light', 'awake', 'deep']);
    expect(segments[1].durationMin).toBe(15);
    expect(segments[2].startMin).toBe(75);
  });
});

describe('sonnoFromServer', () => {
  it('has nothing to show without a night that has stages and an index', () => {
    expect(sonnoFromServer(SONNO_SAMPLE, [])).toBeNull();
    expect(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12', { sleep: null })])).toBeNull();
    expect(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12', { sleep: { ...NIGHT, stages: [] } })])).toBeNull();
    expect(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12', { scores: {} })])).toBeNull();
  });

  it('takes the value, the source, the times and the night from the last day that has them', () => {
    const result = sonnoFromServer(SONNO_SAMPLE, [day('2026-11-11', {}, 50), day('2026-11-12'), day('2026-11-13', { scores: {}, sleep: null })])!;
    expect(result.value).toBe(82);
    expect(result.source).toBe('server');
    expect(result.bedTime).toBe('23:30');
    expect(result.wakeTime).toBe('07:00');
    expect(result.segments).toHaveLength(7);
    expect(result.wakeDate.getDate()).toBe(12);
  });

  it('drops a signal the server did not use and rescales the others to 1', () => {
    const { signals } = sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12')])!;
    expect(signals.map((s) => s.id)).not.toContain('sleep-regularity');
    expect(signals).toHaveLength(6);
    expect(signals.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1, 10);
  });

  it('writes the values from the real night', () => {
    const byId = Object.fromEntries(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12')])!.signals.map((s) => [s.id, s]));
    expect(byId['sleep-duration'].valueText).toBe('7 h 15');
    expect(byId['sleep-efficiency'].valueText).toBe('97%');
    expect(byId['sleep-deep'].valueText).toBe('1 h 10');
    expect(byId['sleep-deep'].baselineText).toBe('16% del sonno');
    expect(byId['sleep-awakenings'].valueText).toBe('1 · 15 min svegli');
    expect(byId['sleep-min-hr'].valueText).toBe('52 bpm');
    expect(byId['sleep-min-hr'].baselineText).toBe('La tua media: 54 bpm');
  });

  it('keeps label and plain-words help of each signal', () => {
    const duration = sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12')])!.signals[0];
    expect(duration.label).toBe('Durata');
    expect(duration.help.length).toBeGreaterThan(20);
  });

  it('reads regularity and its history from the server', () => {
    const regular = (value: number, variationMin: number, weekendGapMin: number | null) => ({
      sleep_regularity: { value, algoVersion: 'v1', components: { variationMin, weekendGapMin } },
    });
    const days = [
      day('2026-11-10', { scores: { ...day('x').scores, ...regular(70, 20, null) } }),
      day('2026-11-11', { scores: { ...day('x').scores, ...regular(80, 25, 12) } }),
      day('2026-11-12', { scores: { ...day('x').scores, ...regular(91, 18.4, 30.2) } }),
    ];
    const result = sonnoFromServer(SONNO_SAMPLE, days)!;
    expect(result.regularity).toEqual({ score: 91, variationMin: 18, weekendGapMin: 30 });
    expect(result.regularityHistory).toEqual([70, 80, 91]);
    expect(result.signals.find((s) => s.id === 'sleep-regularity')).toBeUndefined();
  });

  it('turns the sleep debt in hours into minutes, and uses 0 when the server has none', () => {
    expect(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12')])!.debtMin).toBe(150);
    expect(sonnoFromServer(SONNO_SAMPLE, [day('2026-11-12', { metrics: {} })])!.debtMin).toBe(0);
  });

  it('works with a server that does not send values yet', () => {
    const old = day('2026-11-12');
    delete old.features;
    delete old.references;
    const min = sonnoFromServer(SONNO_SAMPLE, [old])!.signals.find((s) => s.id === 'sleep-min-hr')!;
    expect(min.valueText).toBe('—');
    expect(min.baselineText).toBeUndefined();
  });
});
