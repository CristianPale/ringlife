import {
  Contributor,
  RECOVERY_WEIGHTS,
  draggingContributors,
  recoveryScore,
  scoreFromDeviation,
  verdictFor,
} from './recupero.model';
import { RECUPERO_SAMPLE } from './recupero.sample';
import { zoneForScore } from '../oggi/zone';

function signal(id: Contributor['id'], score: number): Contributor {
  return { id, label: id, weight: RECOVERY_WEIGHTS[id], score, zone: zoneForScore(score), help: '', valueText: '' };
}

describe('recupero model', () => {
  it('has weights that sum to one', () => {
    const total = Object.values(RECOVERY_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('maps a deviation to a score, with 75 on your average', () => {
    expect(scoreFromDeviation(0)).toBe(75);
    expect(scoreFromDeviation(2)).toBe(100);
    expect(scoreFromDeviation(-2)).toBe(50);
  });

  it('limits the deviation to [-3, 3] and the score to 0-100', () => {
    expect(scoreFromDeviation(10)).toBe(100);
    expect(scoreFromDeviation(-10)).toBe(38);
    expect(scoreFromDeviation(-3)).toBe(scoreFromDeviation(-10));
  });

  it('gives 75 when every signal is on your average', () => {
    const all = (['hrv', 'hr-riposo', 'temperatura', 'sonno', 'stress'] as const).map((id) => signal(id, 75));
    expect(recoveryScore(all)).toBe(75);
  });

  it('weights the signals: a low HRV costs more than a low stress', () => {
    const lowHrv = [signal('hrv', 40), signal('stress', 75)];
    const lowStress = [signal('hrv', 75), signal('stress', 40)];
    expect(recoveryScore(lowHrv)).toBeLessThan(recoveryScore(lowStress));
  });

  it('matches the Recupero tile on Oggi (64)', () => {
    expect(RECUPERO_SAMPLE.value).toBe(64);
    expect(RECUPERO_SAMPLE.zone).toBe('attenzione');
  });

  it('picks the verdict from the zone thresholds', () => {
    expect(verdictFor(90).title).toBe('Puoi spingere');
    expect(verdictFor(85).title).toBe('Puoi spingere');
    expect(verdictFor(84).title).toBe('Giornata nella norma');
    expect(verdictFor(70).title).toBe('Giornata nella norma');
    expect(verdictFor(69).title).toBe('Vai piano oggi');
  });

  it('names what drags the score down, most relevant first', () => {
    const names = draggingContributors(RECUPERO_SAMPLE.contributors).map((c) => c.id);
    expect(names).toEqual(['hrv', 'hr-riposo']);
  });

  it('names nothing when every signal is at or above your average', () => {
    const fine = [signal('hrv', 80), signal('hr-riposo', 75), signal('sonno', 90)];
    expect(draggingContributors(fine)).toEqual([]);
  });

  it('keeps at most two dragging signals', () => {
    const bad = (['hrv', 'hr-riposo', 'temperatura', 'sonno'] as const).map((id) => signal(id, 20));
    expect(draggingContributors(bad)).toHaveLength(2);
  });

  it('ends the 90-day history with the same week as the tile', () => {
    const history = RECUPERO_SAMPLE.history;
    expect(history).toHaveLength(90);
    expect(history.slice(-7)).toEqual([78, 82, 76, 72, 80, 69, 64]);
    expect(history.every((v) => v >= 0 && v <= 100)).toBe(true);
  });
});
