import { breathPhase, formatElapsed, sessionStats } from './session.model';

describe('session model', () => {
  it('breathes in for 4 seconds and out for 6, opening and closing the circle', () => {
    expect(breathPhase(0)).toEqual({ phase: 'inspira', remaining: 4, openness: 0 });
    expect(breathPhase(4_000).phase).toBe('espira');
    expect(breathPhase(4_000).openness).toBe(1);
    expect(breathPhase(9_999).phase).toBe('espira');
    expect(breathPhase(10_000).phase).toBe('inspira');
    expect(breathPhase(2_000).openness).toBeCloseTo(0.5);
  });

  it('summarises a session: min, mean, max, and the first and last half minute', () => {
    const samples = [
      { t: 0, bpm: 80 },
      { t: 10_000, bpm: 76 },
      { t: 60_000, bpm: 66 },
      { t: 90_000, bpm: 62 },
    ];
    expect(sessionStats(samples)).toEqual({ min: 62, avg: 71, max: 80, start: 78, end: 64 });
    expect(sessionStats([])).toBeNull();
  });

  it('writes elapsed time as minutes and seconds', () => {
    expect(formatElapsed(65_400)).toBe('1:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
