import { ANDAMENTO_SAMPLE } from '../andamento/andamento.sample';
import { formatThousands } from '../shared/format';
import { GLOSSARY } from './glossary';
import {
  MOVEMENT_WEIGHTS,
  activeHoursScore,
  evaluateMovementDay,
  hrMinutesScore,
  sedentaryScore,
  sedentaryStretches,
  stepsScore,
} from './movimento.model';

const help = {
  'move-steps': GLOSSARY['move-steps'],
  'move-active-hours': GLOSSARY['move-active-hours'],
  'move-hr-minutes': GLOSSARY['move-hr-minutes'],
  'move-sedentary': GLOSSARY['move-sedentary'],
};

const idle = Array(24).fill(0);
const busy = Array(24).fill(500);

describe('movimento model', () => {
  it('has weights that sum to one', () => {
    const total = Object.values(MOVEMENT_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('scores steps against the goal, capped at 100', () => {
    expect(stepsScore(4000, 8000)).toBe(50);
    expect(stepsScore(8000, 8000)).toBe(100);
    expect(stepsScore(20000, 8000)).toBe(100);
    expect(stepsScore(0, 8000)).toBe(0);
    expect(stepsScore(5000, 0)).toBe(0);
  });

  it('scores active hours and effort minutes against their full value', () => {
    expect(activeHoursScore(5)).toBe(50);
    expect(activeHoursScore(14)).toBe(100);
    expect(hrMinutesScore(15)).toBe(50);
    expect(hrMinutesScore(60)).toBe(100);
  });

  describe('sedentary stretches', () => {
    it('finds none in a busy day', () => {
      expect(sedentaryStretches(busy)).toEqual([]);
    });

    it('does not count a single idle hour', () => {
      const day = [...busy];
      day[11] = 0;
      expect(sedentaryStretches(day)).toEqual([]);
    });

    it('counts a stretch of 2 hours and one of 3', () => {
      const day = [...busy];
      day[10] = 0;
      day[11] = 100;
      day[15] = 0;
      day[16] = 0;
      day[17] = 0;
      expect(sedentaryStretches(day)).toEqual([
        { from: 10, to: 12 },
        { from: 15, to: 18 },
      ]);
    });

    it('ignores the night: idle hours before 07:00 and from 23:00 do not count', () => {
      const day = [...busy];
      for (const h of [0, 1, 2, 3, 4, 5, 6, 23]) {
        day[h] = 0;
      }
      expect(sedentaryStretches(day)).toEqual([]);
    });

    it('stops a stretch at 23:00', () => {
      const day = [...busy];
      day[21] = 0;
      day[22] = 0;
      expect(sedentaryStretches(day)).toEqual([{ from: 21, to: 23 }]);
    });

    it('counts a whole idle day as one stretch', () => {
      expect(sedentaryStretches(idle)).toEqual([{ from: 7, to: 23 }]);
    });
  });

  it('loses 12,5 points per hour spent in long stretches, down to 0', () => {
    expect(sedentaryScore([])).toBe(100);
    expect(sedentaryScore([{ from: 15, to: 17 }, { from: 21, to: 23 }])).toBe(50);
    expect(sedentaryScore([{ from: 10, to: 13 }])).toBe(63);
    expect(sedentaryScore([{ from: 7, to: 23 }])).toBe(0);
  });

  it('evaluates the sample day: 74 with two long stretches', () => {
    const day = evaluateMovementDay(
      { steps: 5470, stepsGoal: 8000, stepsByHour: ANDAMENTO_SAMPLE.stepsYesterdayByHour, hrMinutes: 18 },
      help,
      formatThousands,
    );
    expect(day.signals.map((s) => s.score)).toEqual([68, 100, 60, 50]);
    expect(day.value).toBe(74);
    expect(day.stretches).toEqual([
      { from: 15, to: 17 },
      { from: 21, to: 23 },
    ]);
  });

  it('is 100 for a perfect day and 0 for an empty one', () => {
    const perfect = evaluateMovementDay(
      { steps: 12000, stepsGoal: 8000, stepsByHour: busy, hrMinutes: 45 },
      help,
      formatThousands,
    );
    expect(perfect.value).toBe(100);
    const empty = evaluateMovementDay({ steps: 0, stepsGoal: 8000, stepsByHour: idle, hrMinutes: 0 }, help, formatThousands);
    expect(empty.value).toBe(0);
  });

  it('follows the goal chosen in settings', () => {
    const input = { steps: 5470, stepsByHour: ANDAMENTO_SAMPLE.stepsYesterdayByHour, hrMinutes: 18 };
    const low = evaluateMovementDay({ ...input, stepsGoal: 5000 }, help, formatThousands);
    const high = evaluateMovementDay({ ...input, stepsGoal: 12000 }, help, formatThousands);
    expect(low.value).toBeGreaterThan(high.value);
  });
});
