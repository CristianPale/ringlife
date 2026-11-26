import { dateText, dayNumber, monthOf, monthTitle, monthWeeks, shiftMonth } from './day-calendar';

describe('day calendar', () => {
  it('moves across years by month', () => {
    expect(monthOf('2026-11-17')).toBe('2026-11');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('lays out a month in weeks from Monday, with empty cells outside it', () => {
    // 1 novembre 2026 è una domenica: sei caselle vuote prima.
    const weeks = monthWeeks('2026-11');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(30);
  });

  it('counts leap years', () => {
    expect(monthWeeks('2028-02').flat().filter((d) => d !== null)).toHaveLength(29);
    expect(monthWeeks('2026-02').flat().filter((d) => d !== null)).toHaveLength(28);
  });

  it('names months and days in Italian, with the year only when it is not this one', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    expect(monthTitle('2026-11')).toBe('Novembre 2026');
    expect(dateText('2026-11-17', now)).toBe('martedì 17 novembre');
    expect(dateText('2025-12-31', now)).toBe('mercoledì 31 dicembre 2025');
    expect(dayNumber('2026-11-07')).toBe(7);
  });
});
