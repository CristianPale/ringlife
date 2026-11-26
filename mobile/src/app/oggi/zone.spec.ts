import { ZONE_LABELS, zoneForScore } from './zone';

describe('zoneForScore', () => {
  it('maps the initial thresholds', () => {
    expect(zoneForScore(100)).toBe('ottimo');
    expect(zoneForScore(85)).toBe('ottimo');
    expect(zoneForScore(84)).toBe('buono');
    expect(zoneForScore(70)).toBe('buono');
    expect(zoneForScore(69)).toBe('attenzione');
    expect(zoneForScore(0)).toBe('attenzione');
  });

  it('never assigns the high zone to a score: it belongs to migraine risk only', () => {
    for (let score = 0; score <= 100; score++) {
      expect(zoneForScore(score)).not.toBe('alto');
    }
  });

  it('has an Italian label for every zone', () => {
    expect(ZONE_LABELS).toEqual({ ottimo: 'Ottimo', buono: 'Buono', attenzione: 'Attenzione', alto: 'Alto' });
  });
});
