import { DayView } from '../api/api.model';
import { chosenDay, dayName, daysUpTo, daysWith, nightName, shiftDay } from './day-history';

const day = (date: string, withSleep = true): DayView => ({
  day: date,
  scores: withSleep ? { sleep: { value: 70, algoVersion: 'v1', components: [] } } : {},
  metrics: {},
  baselines: {},
});

describe('day history', () => {
  const days = [day('2026-11-15'), day('2026-11-16', false), day('2026-11-17'), day('2026-11-18')];

  it('cuts the days at the chosen one, so the latest becomes that day', () => {
    expect(daysUpTo(days, '2026-11-16').map((d) => d.day)).toEqual(['2026-11-15', '2026-11-16']);
    expect(daysUpTo(days, null)).toBe(days);
  });

  it('lists only the days a page can show, and takes a request only if it is one of them', () => {
    const available = daysWith(days, (d) => !!d.scores['sleep']);
    expect(available).toEqual(['2026-11-15', '2026-11-17', '2026-11-18']);
    expect(chosenDay('2026-11-17', available)).toBe('2026-11-17');
    expect(chosenDay('2026-11-16', available)).toBeNull();
    // Il più recente è la vista normale: nessuna scelta.
    expect(chosenDay('2026-11-18', available)).toBeNull();
    expect(chosenDay(undefined, available)).toBeNull();
  });

  it('names days and nights the way the app speaks', () => {
    const now = new Date('2026-11-19T09:00:00Z');
    expect(dayName('2026-11-19', now)).toBe('oggi');
    expect(dayName('2026-11-18', now)).toBe('ieri');
    expect(dayName('2026-11-16', now)).toBe('lunedì 16 novembre');
    expect(nightName('2026-11-17')).toBe('Notte da lunedì a martedì');
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2026-03-28', 2)).toBe('2026-03-30');
  });
});
