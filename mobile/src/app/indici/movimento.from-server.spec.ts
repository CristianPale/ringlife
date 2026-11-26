import { DayView } from '../api/api.model';
import { movementDays, movimentoFromServer } from './movimento.from-server';
import { MOVIMENTO_SAMPLE } from './movimento.sample';

const hours = (value: number) => Array.from({ length: 24 }, (_, h) => (h >= 8 && h <= 20 ? value : 0));

function day(date: string, steps: number | null, byHour: number[] | null = steps === null ? null : hours(steps / 13), hr = 25): DayView {
  return {
    day: date,
    scores: {},
    metrics: {},
    baselines: {},
    features: steps === null ? {} : { steps, hr_minutes: hr },
    stepsByHour: byHour,
  };
}

describe('movimentoFromServer', () => {
  it('has nothing to show with fewer than two days, or no finished day with steps by hour', () => {
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, [])).toBeNull();
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, [day('2026-11-12', 1000)])).toBeNull();
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, [day('2026-11-11', null), day('2026-11-12', 1000)])).toBeNull();
  });

  it("takes today's steps from the last day, rounded", () => {
    const result = movimentoFromServer(MOVIMENTO_SAMPLE, [day('2026-11-11', 9100), day('2026-11-12', 1239.6)])!;
    expect(result.stepsToday).toBe(1240);
    expect(result.source).toBe('server');
    expect(result.today.getDate()).toBe(12);
  });

  it('uses the last finished day with steps by hour as «yesterday»', () => {
    const days = [day('2026-11-09', 5200), day('2026-11-10', 9100, hours(700), 31), day('2026-11-11', null), day('2026-11-12', 300)];
    const result = movimentoFromServer(MOVIMENTO_SAMPLE, days)!;
    expect(result.stepsYesterdayByHour).toEqual(hours(700));
    expect(result.hrMinutesYesterday).toBe(31);
  });

  it('builds the history from finished days only, oldest first, without today', () => {
    const days = [day('2026-11-09', 5200), day('2026-11-10', 9100), day('2026-11-11', null), day('2026-11-12', 300)];
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, days)!.stepsHistory).toEqual([5200, 9100]);
  });

  it('shows zero steps today when the server has none yet, instead of the example', () => {
    const result = movimentoFromServer(MOVIMENTO_SAMPLE, [day('2026-11-11', 9100), day('2026-11-12', null)])!;
    expect(result.stepsToday).toBe(0);
  });

  it('ignores steps by hour that are not 24 values', () => {
    const bad = day('2026-11-11', 9100, [1, 2, 3]);
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, [bad, day('2026-11-12', 10)])).toBeNull();
  });

  it('reads a missing minutes-in-zone value as zero', () => {
    const noHr = day('2026-11-11', 9100);
    delete noHr.features!['hr_minutes'];
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, [noHr, day('2026-11-12', 10)])!.hrMinutesYesterday).toBe(0);
  });

  it('shows a chosen finished day instead of yesterday, with the history up to that day', () => {
    const days = [day('2026-11-10', 4000), day('2026-11-11', 9100, null), day('2026-11-12', 6500, null, 40), day('2026-11-13', 300)];
    // L'11 non ha i passi per ora e oggi (13) non è concluso: si possono rivedere solo il 10 e il 12.
    expect(movementDays(days)).toEqual(['2026-11-10']);
    const withHours = [day('2026-11-10', 4000), day('2026-11-11', 9100), day('2026-11-12', 6500, undefined, 40), day('2026-11-13', 300)];
    expect(movementDays(withHours)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    const result = movimentoFromServer(MOVIMENTO_SAMPLE, withHours, '2026-11-11')!;
    expect(result.today.getDate()).toBe(11);
    expect(result.stepsToday).toBe(9100);
    expect(result.stepsHistory).toEqual([4000, 9100]);
    expect(movimentoFromServer(MOVIMENTO_SAMPLE, days, '2026-11-11')).toBeNull();
  });
});
