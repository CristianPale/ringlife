import { evaluateBreathing, nightSummary, spo2Deviation } from './respiro.model';
import { RESPIRO_SAMPLE } from './respiro.sample';

const stable = (n: number, value = 96) => Array(n).fill(value);
const night = (value: number, count = 30) => Array(count).fill(value);

describe('respiro model', () => {
  describe('nightSummary', () => {
    it('gives median and minimum with 10 or more samples', () => {
      expect(nightSummary([96, 97, 95, 96, 96, 94, 97, 96, 95, 91])).toEqual({ median: 96, min: 91, count: 10 });
    });

    it('says nothing with fewer than 10 samples', () => {
      expect(nightSummary(Array(9).fill(96))).toBeNull();
      expect(nightSummary([])).toBeNull();
    });
  });

  describe('spo2Deviation', () => {
    it('is 0 on your average', () => {
      expect(spo2Deviation(96, [95, 96, 97, 96, 96, 97, 95, 96])).toBe(0);
    });

    it('is negative below your average and limited to -3', () => {
      expect(spo2Deviation(94, [95, 96, 97, 96, 96, 97, 95, 96])).toBeLessThan(-1);
      expect(spo2Deviation(80, [95, 96, 97, 96, 96, 97, 95, 96])).toBe(-3);
      expect(spo2Deviation(100, [95, 96, 97, 96, 96, 97, 95, 96])).toBeLessThanOrEqual(3);
    });

    it('needs at least 7 previous nights', () => {
      expect(spo2Deviation(96, stable(6))).toBeNull();
      expect(spo2Deviation(96, stable(7))).toBe(0);
    });

    it('does not explode when the person is perfectly stable', () => {
      // MAD 0: senza un minimo, un solo punto in meno varrebbe «infinite» volte la variabilità.
      expect(spo2Deviation(95, stable(20))).toBeCloseTo(-2, 5);
      expect(spo2Deviation(96, stable(20))).toBe(0);
    });

    it('uses only the last 28 nights', () => {
      const old = stable(40, 90);
      const recent = stable(28, 96);
      expect(spo2Deviation(96, [...old, ...recent])).toBe(0);
    });
  });

  describe('evaluateBreathing', () => {
    it('is stable: a normal night is on track', () => {
      const result = evaluateBreathing(night(96), stable(30));
      expect(result).toMatchObject({ status: 'ok', median: 96, baseline: 96, streak: 0 });
    });

    it('is insufficient with fewer than 10 samples, even with a long history', () => {
      const result = evaluateBreathing(night(96, 9), stable(30));
      expect(result.status).toBe('insufficient');
      expect(result.count).toBe(9);
      expect(result.median).toBeNull();
    });

    it('is calibrating before 7 previous nights', () => {
      expect(evaluateBreathing(night(96), stable(6)).status).toBe('calibrating');
      expect(evaluateBreathing(night(96), []).status).toBe('calibrating');
    });

    it('does not flag a single low night, nor two', () => {
      expect(evaluateBreathing(night(93), stable(30)).status).toBe('ok');
      expect(evaluateBreathing(night(93), [...stable(30), 93]).status).toBe('ok');
      expect(evaluateBreathing(night(93), [...stable(30), 93]).streak).toBe(2);
    });

    it('flags three low nights in a row', () => {
      const result = evaluateBreathing(night(93), [...stable(30), 93, 93]);
      expect(result.status).toBe('watch');
      expect(result.streak).toBe(3);
    });

    it('does not flag three low nights that are not consecutive', () => {
      expect(evaluateBreathing(night(93), [...stable(30), 93, 96]).status).toBe('ok');
      expect(evaluateBreathing(night(96), [...stable(30), 93, 93]).status).toBe('ok');
    });

    it('uses no absolute threshold: a steady 92% is not flagged', () => {
      expect(evaluateBreathing(night(92), stable(40, 92)).status).toBe('ok');
    });

    it('ignores a low minimum when the median is normal', () => {
      const samples = [...night(96, 29), 85];
      expect(evaluateBreathing(samples, stable(30)).status).toBe('ok');
      expect(evaluateBreathing(samples, stable(30)).min).toBe(85);
    });
  });

  it('has a sample night that is on track, with a low minimum and 42 samples', () => {
    const result = evaluateBreathing(RESPIRO_SAMPLE.tonight, RESPIRO_SAMPLE.history);
    expect(result.status).toBe('ok');
    expect(result.count).toBe(42);
    expect(result.min).toBe(91);
    expect(RESPIRO_SAMPLE.history).toHaveLength(89);
  });
});
