import { EMPTY_DETAILS, HeadacheEpisode } from './headache.model';
import { episodeSummary, peakIntensity } from './headache-labels';

function base(): HeadacheEpisode {
  return {
    id: 'a',
    startedAt: new Date(2026, 10, 3, 7, 44).toISOString(),
    endedAt: new Date(2026, 10, 3, 8, 56).toISOString(),
    intensity: 4,
    intensityLog: [
      { at: new Date(2026, 10, 3, 7, 44).toISOString(), value: 6 },
      { at: new Date(2026, 10, 3, 8, 20).toISOString(), value: 4 },
    ],
    medicationAt: [],
    details: { ...EMPTY_DETAILS },
    completedAt: null,
  };
}

describe('peakIntensity', () => {
  it('is the highest value reached, not the last', () => {
    expect(peakIntensity(base())).toBe(6);
  });
});

describe('episodeSummary', () => {
  it('shows the time range and the peak', () => {
    expect(episodeSummary(base())).toBe('07:44–08:56 · intensità massima 6');
  });

  it('adds one medication time', () => {
    const ep = { ...base(), medicationAt: [new Date(2026, 10, 3, 7, 58).toISOString()] };
    expect(episodeSummary(ep)).toBe('07:44–08:56 · intensità massima 6 · farmaco alle 07:58');
  });

  it('counts several medications', () => {
    const at = new Date(2026, 10, 3, 7, 58).toISOString();
    expect(episodeSummary({ ...base(), medicationAt: [at, at] })).toContain('2 farmaci');
  });
});
