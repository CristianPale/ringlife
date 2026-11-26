import { DayView } from '../api/api.model';
import { recuperoFromServer } from './recupero.from-server';
import { RECUPERO_SAMPLE } from './recupero.sample';

interface Comp {
  id: string;
  weight: number;
  score: number | null;
}

const ALL: Comp[] = [
  { id: 'hrv', weight: 0.35, score: 56 },
  { id: 'hr-riposo', weight: 0.25, score: 65 },
  { id: 'temperatura', weight: 0.15, score: 75 },
  { id: 'sonno', weight: 0.15, score: 62 },
  { id: 'stress', weight: 0.1, score: null },
];

function day(date: string, value: number | null, components: Comp[] = ALL, extra: Partial<DayView> = {}): DayView {
  return {
    day: date,
    scores: value === null ? {} : { recovery: { value, algoVersion: 'v1', components } },
    metrics: { temp_deviation: { value: 0.3, unit: 'C', detail: null, algoVersion: 'v1' } },
    baselines: {},
    features: { hrv_night: 43.4, resting_hr: 56.2 },
    references: {
      hrv_night: { median: 52, deviation: -1.5 },
      resting_hr: { median: 54, deviation: 0.8 },
      temp_night: { median: 34.2, deviation: 0.4 },
    },
    ...extra,
  };
}

describe('recuperoFromServer', () => {
  it('has nothing to show without a calculated recovery', () => {
    expect(recuperoFromServer(RECUPERO_SAMPLE, [])).toBeNull();
    expect(recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', null)])).toBeNull();
  });

  it('takes the value, the zone and the source from the last day that has a recovery', () => {
    const result = recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-11', 91), day('2026-11-12', 64), day('2026-11-13', null)])!;
    expect(result.value).toBe(64);
    expect(result.zone).toBe('attenzione');
    expect(result.source).toBe('server');
    expect(result.date.getDate()).toBe(12);
  });

  it('drops a signal the server did not use and rescales the others to 1', () => {
    const result = recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', 64)])!;
    expect(result.contributors.map((c) => c.id)).toEqual(['hrv', 'hr-riposo', 'temperatura', 'sonno']);
    const total = result.contributors.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.contributors[0].weight).toBeCloseTo(0.35 / 0.9, 10);
  });

  it('keeps the label and the plain-words explanation of every signal', () => {
    const [hrv, , , sonno] = recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', 64)])!.contributors;
    expect(hrv.label).toBe('HRV');
    expect(hrv.fullName).toBe('Variabilità della frequenza cardiaca');
    expect(hrv.help.length).toBeGreaterThan(20);
    expect(sonno.fullName).toBeUndefined();
  });

  it("writes today's value and your average with units", () => {
    const [hrv, rhr, temp, sonno] = recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', 64)])!.contributors;
    expect(hrv.valueText).toBe('43 ms');
    expect(hrv.baselineText).toBe('La tua media: 52 ms');
    expect(rhr.valueText).toBe('56 bpm');
    expect(rhr.baselineText).toBe('La tua media: 54 bpm');
    expect(temp.valueText).toBe('+0,3 °C');
    expect(sonno.valueText).toBe('62 su 100');
  });

  it('puts a dash instead of inventing a value the server did not send', () => {
    const bare = day('2026-11-12', 64, ALL, { features: {}, references: {}, metrics: {} });
    const [hrv, rhr, temp] = recuperoFromServer(RECUPERO_SAMPLE, [bare])!.contributors;
    expect([hrv.valueText, rhr.valueText, temp.valueText]).toEqual(['—', '—', '—']);
    expect(hrv.baselineText).toBeUndefined();
  });

  it('works with a server that does not send values yet', () => {
    const old = day('2026-11-12', 64);
    delete old.features;
    delete old.references;
    const result = recuperoFromServer(RECUPERO_SAMPLE, [old])!;
    expect(result.deviations).toEqual({ rhr: null, hrv: null, temp: null });
  });

  it('passes the deviations for the fatigue signals', () => {
    expect(recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', 64)])!.deviations).toEqual({ rhr: 0.8, hrv: -1.5, temp: 0.4 });
  });

  it('builds the history from the days that have a recovery, oldest first', () => {
    const days = [day('2026-11-10', 70), day('2026-11-11', null), day('2026-11-12', 64)];
    expect(recuperoFromServer(RECUPERO_SAMPLE, days)!.history).toEqual([70, 64]);
  });

  it('ignores a component it does not know', () => {
    const odd: Comp[] = [...ALL, { id: 'novità', weight: 0.2, score: 10 }];
    expect(recuperoFromServer(RECUPERO_SAMPLE, [day('2026-11-12', 64, odd)])!.contributors).toHaveLength(4);
  });

  it('reads a score without a component list as empty, without crashing', () => {
    const broken = day('2026-11-12', 64);
    broken.scores['recovery'].components = null;
    expect(recuperoFromServer(RECUPERO_SAMPLE, [broken])!.contributors).toEqual([]);
  });
});
