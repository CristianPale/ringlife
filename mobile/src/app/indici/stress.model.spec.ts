import { HIGH_STRESS, STRESS_WEIGHTS, hoursWithData, sharePercent, verdictFor } from './stress.model';
import { STRESS_SAMPLE } from './stress.sample';

describe('stress model', () => {
  it('has weights that add up to one and match the server', () => {
    expect(STRESS_WEIGHTS['stress-load'] + STRESS_WEIGHTS['stress-evening']).toBeCloseTo(1, 10);
    expect(STRESS_WEIGHTS['stress-load']).toBe(0.7);
    expect(HIGH_STRESS).toBe(60);
  });

  it('describes the day with the same thresholds as the zones', () => {
    expect(verdictFor(90).title).toBe('Giornata tranquilla');
    expect(verdictFor(85).title).toBe('Giornata tranquilla');
    expect(verdictFor(84).title).toBe('Giornata nella norma');
    expect(verdictFor(70).title).toBe('Giornata nella norma');
    expect(verdictFor(69).title).toBe('Giornata tesa');
  });

  it('never gives medical advice in the verdict', () => {
    for (const score of [20, 75, 95]) {
      const text = `${verdictFor(score).title} ${verdictFor(score).detail}`.toLowerCase();
      expect(text).not.toMatch(/medic|diagnos|farmac|terapia/);
    }
  });

  it('counts the hours with data between 07:00 and 23:00 only', () => {
    expect(hoursWithData(STRESS_SAMPLE.byHour)).toBe(16);
    expect(hoursWithData(Array<number | null>(24).fill(50))).toBe(16);
    expect(hoursWithData(Array<null>(24).fill(null))).toBe(0);
  });

  it('writes the share as a rounded percent', () => {
    expect(sharePercent(0.1)).toBe(10);
    expect(sharePercent(0.126)).toBe(13);
    expect(sharePercent(0)).toBe(0);
  });

  it('has a coherent sample: 0,7 × 80 + 0,3 × 60 = 74', () => {
    const total = STRESS_SAMPLE.signals.reduce((sum, s) => sum + s.weight * s.score, 0);
    expect(Math.round(total)).toBe(STRESS_SAMPLE.value);
    expect(STRESS_SAMPLE.history.at(-1)).toBe(74);
    expect(STRESS_SAMPLE.history).toHaveLength(90);
  });
});
