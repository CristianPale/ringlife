import { EMPTY_DETAILS, HeadacheEpisode } from '../diary/headache.model';
import { buildMonth, monthOf } from './migraine-month';

function episode(startedAt: string, endedAt: string | null, medicationAt: string[] = []): HeadacheEpisode {
  return { id: startedAt, startedAt, endedAt, intensity: 6, intensityLog: [], medicationAt, details: EMPTY_DETAILS, completedAt: null };
}

describe('monthOf', () => {
  it('takes the month in Rome, not in UTC', () => {
    expect(monthOf(new Date('2026-10-31T23:30:00Z'))).toEqual({ year: 2026, month: 11 });
    expect(monthOf(new Date('2026-11-14T10:00:00Z'))).toEqual({ year: 2026, month: 11 });
  });

  it('moves by whole months across the year', () => {
    expect(monthOf(new Date('2026-01-10T10:00:00Z'), -1)).toEqual({ year: 2025, month: 12 });
    expect(monthOf(new Date('2026-11-14T10:00:00Z'), -11)).toEqual({ year: 2025, month: 12 });
    expect(monthOf(new Date('2026-11-14T10:00:00Z'), 2)).toEqual({ year: 2027, month: 1 });
  });
});

describe('buildMonth', () => {
  it('lays November 2026 out in weeks from Monday, with filler cells', () => {
    const month = buildMonth([], 2026, 11);
    expect(month.title).toBe('Novembre 2026');
    // Il primo novembre 2026 è domenica: sei caselle vuote prima.
    expect(month.weeks[0].slice(0, 6).every((c) => c.day === null)).toBe(true);
    expect(month.weeks[0][6].day).toBe(1);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
    expect(month.weeks.flat().filter((c) => c.day !== null)).toHaveLength(30);
  });

  it('marks days with an episode, and with a medication when one was taken', () => {
    const month = buildMonth(
      [
        episode('2026-11-03T05:20:00Z', '2026-11-03T08:00:00Z', ['2026-11-03T06:00:00Z']),
        episode('2026-11-09T14:00:00Z', '2026-11-09T16:00:00Z'),
      ],
      2026,
      11,
    );
    const day = (n: number) => month.weeks.flat().find((c) => c.day === n)?.kind;
    expect(day(3)).toBe('medication');
    expect(day(9)).toBe('episode');
    expect(day(4)).toBe('none');
  });

  it('keeps the medication mark when two episodes fall on the same day', () => {
    const month = buildMonth(
      [episode('2026-11-03T05:20:00Z', null, ['2026-11-03T06:00:00Z']), episode('2026-11-03T15:00:00Z', null)],
      2026,
      11,
    );
    expect(month.weeks.flat().find((c) => c.day === 3)?.kind).toBe('medication');
    expect(month.medicationDays).toBe(1);
    expect(month.episodes).toBe(2);
  });

  it('counts only the episodes of the month, in Rome time', () => {
    const month = buildMonth(
      [episode('2026-10-31T23:30:00Z', null), episode('2026-11-30T23:30:00Z', null), episode('2026-10-20T10:00:00Z', null)],
      2026,
      11,
    );
    // 31/10 23:30 UTC è il primo novembre a Roma; 30/11 23:30 UTC è già il primo dicembre.
    expect(month.episodes).toBe(1);
    expect(month.weeks.flat().find((c) => c.day === 1)?.kind).toBe('episode');
  });

  it('averages the duration of the finished episodes only', () => {
    const month = buildMonth(
      [
        episode('2026-11-03T05:00:00Z', '2026-11-03T07:00:00Z'),
        episode('2026-11-05T05:00:00Z', '2026-11-05T06:00:00Z'),
        episode('2026-11-07T05:00:00Z', null),
      ],
      2026,
      11,
    );
    expect(month.averageDurationMin).toBe(90);
    expect(buildMonth([], 2026, 11).averageDurationMin).toBeNull();
  });
});
