import { HABIT_BACKFILL_DAYS, HabitualCaffeine, dueHabitEntries, habitEntryDay, habitEntryId, isHabitual, newHabitId, normalizeHabits } from './habits';

describe('habitual caffeine', () => {
  const coffee: HabitualCaffeine = { id: 'abc123', drink: 'coffee', time: '08:00', since: '2026-11-20' };
  const none = new Set<string>();

  it('gives every habit and day a stable id the server accepts', () => {
    expect(habitEntryId('abc123', '2026-11-22')).toBe('habit-abc123-20261122');
    expect(isHabitual('habit-abc123-20261122')).toBe(true);
    expect(isHabitual('0c6f9d1e-uuid')).toBe(false);
    expect(habitEntryDay('habit-abc123-20261122')).toBe('2026-11-22');
    expect(habitEntryDay('0c6f9d1e-uuid')).toBeNull();
  });

  it('adds the entry of each day from the start, at the habit time, once the time has passed', () => {
    const due = dueHabitEntries([coffee], none, none, new Date(2026, 10, 22, 9, 30));
    expect(due.map((e) => e.id)).toEqual(['habit-abc123-20261120', 'habit-abc123-20261121', 'habit-abc123-20261122']);
    expect(due[2]).toEqual({ id: 'habit-abc123-20261122', at: new Date(2026, 10, 22, 8, 0).toISOString(), kind: 'caffeine', drink: 'coffee' });
  });

  it('waits for the time of today', () => {
    const due = dueHabitEntries([coffee], none, none, new Date(2026, 10, 22, 7, 59));
    expect(due.map((e) => e.id)).toEqual(['habit-abc123-20261120', 'habit-abc123-20261121']);
  });

  it('never adds again an entry the diary has or one taken away for that day', () => {
    const known = new Set(['habit-abc123-20261120']);
    const skipped = new Set(['habit-abc123-20261121']);
    const due = dueHabitEntries([coffee], known, skipped, new Date(2026, 10, 22, 9, 30));
    expect(due.map((e) => e.id)).toEqual(['habit-abc123-20261122']);
  });

  it('goes back at most two weeks when the app was not opened', () => {
    const old = { ...coffee, since: '2026-01-01' };
    expect(dueHabitEntries([old], none, none, new Date(2026, 10, 22, 9, 30))).toHaveLength(HABIT_BACKFILL_DAYS);
  });

  it('reads back the habits and drops the ones that do not fit', () => {
    expect(
      normalizeHabits([
        coffee,
        { ...coffee, id: 'abc123' },
        { ...coffee, id: 'BAD ID' },
        { ...coffee, id: 'x1', drink: 'beer' },
        { ...coffee, id: 'x2', time: '25:00' },
        { ...coffee, id: 'x3', since: 'ieri' },
        'nope',
      ]),
    ).toEqual([coffee]);
    expect(normalizeHabits(undefined)).toEqual([]);
  });

  it('makes a new id that no other habit has', () => {
    const values = [0.5, 0.5, 0.25];
    const random = () => values.shift() ?? 0.75;
    const first = newHabitId([]);
    expect(first).toMatch(/^[a-z0-9]{6}$/);
    const taken = newHabitId([], () => 0.5);
    expect(newHabitId([{ ...coffee, id: taken }], random)).not.toBe(taken);
  });
});
