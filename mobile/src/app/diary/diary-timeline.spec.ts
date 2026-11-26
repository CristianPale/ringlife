import { buildTimeline, dayLabel, kindsPresent } from './diary-timeline';
import { JournalEntry } from './journal.model';
import { HeadacheEpisode } from './headache.model';
import { EMPTY_DETAILS } from './headache.model';

function episode(id: string, start: Date, end: Date | null, intensity = 6): HeadacheEpisode {
  return {
    id,
    startedAt: start.toISOString(),
    endedAt: end?.toISOString() ?? null,
    intensity,
    intensityLog: [{ at: start.toISOString(), value: intensity }],
    medicationAt: [],
    details: { ...EMPTY_DETAILS },
    completedAt: null,
  };
}

describe('dayLabel', () => {
  const now = new Date(2026, 10, 3, 20, 30);

  it('says today and yesterday', () => {
    expect(dayLabel(new Date(2026, 10, 3, 1, 0), now)).toBe('Oggi');
    expect(dayLabel(new Date(2026, 10, 2, 23, 59), now)).toBe('Ieri');
  });

  it('writes older days with weekday, day and month', () => {
    expect(dayLabel(new Date(2026, 9, 30, 12, 0), now)).toBe('venerdì 30 ottobre');
  });
});

describe('buildTimeline', () => {
  const now = new Date(2026, 10, 3, 20, 30);

  it('groups by day, newest first', () => {
    const timeline = buildTimeline(
      [
        episode('old', new Date(2026, 10, 1, 9, 0), new Date(2026, 10, 1, 10, 0)),
        episode('today', new Date(2026, 10, 3, 7, 44), new Date(2026, 10, 3, 8, 56)),
        episode('today2', new Date(2026, 10, 3, 15, 0), new Date(2026, 10, 3, 15, 30)),
      ],
      [],
      now,
    );

    expect(timeline.map((d) => d.label)).toEqual(['Oggi', 'domenica 1 novembre']);
    expect(timeline[0].entries.map((e) => e.id)).toEqual(['today2', 'today']);
    expect(timeline[0].entries[1].time).toBe('07:44');
  });

  it('describes a finished and an open episode', () => {
    const [today] = buildTimeline(
      [
        episode('done', new Date(2026, 10, 3, 7, 44), new Date(2026, 10, 3, 8, 56), 6),
        episode('open', new Date(2026, 10, 3, 19, 0), null, 3),
      ],
      [],
      now,
    );

    expect(today.entries[0].text).toBe('Cefalea · in corso, intensità 3');
    expect(today.entries[1].text).toBe('Cefalea · intensità massima 6 · 1 h 12');
  });

  it('filters by kind and returns nothing for an empty list', () => {
    const list = [episode('a', new Date(2026, 10, 3, 7, 44), new Date(2026, 10, 3, 8, 0))];
    expect(buildTimeline(list, [], now, ['headache'])).toHaveLength(1);
    expect(buildTimeline([], [], now)).toEqual([]);
  });

  it('mixes journal entries and headaches in time order', () => {
    const journal: JournalEntry[] = [
      { id: 'c', kind: 'caffeine', at: new Date(2026, 10, 3, 9, 20).toISOString(), drink: 'coffee' },
      { id: 'w', kind: 'alcohol', at: new Date(2026, 10, 2, 20, 30).toISOString(), drink: 'wine' },
      { id: 'n', kind: 'note', at: new Date(2026, 10, 3, 10, 0).toISOString(), text: 'dormito male' },
    ];
    const list = [episode('h', new Date(2026, 10, 3, 7, 44), new Date(2026, 10, 3, 8, 56))];
    const timeline = buildTimeline(list, journal, now);

    expect(timeline.map((d) => d.label)).toEqual(['Oggi', 'Ieri']);
    expect(timeline[0].entries.map((e) => e.id)).toEqual(['n', 'c', 'h']);
    expect(timeline[0].entries[1].text).toBe('Caffeina · 1 caffè');
    expect(timeline[1].entries[0].text).toBe('Alcol · 1 bicchiere di vino');
    expect(timeline[0].entries[0].text).toBe('Nota · dormito male');
  });

  it('filters journal kinds', () => {
    const journal: JournalEntry[] = [
      { id: 'c', kind: 'caffeine', at: new Date(2026, 10, 3, 9, 20).toISOString(), drink: 'coffee' },
      { id: 'w', kind: 'alcohol', at: new Date(2026, 10, 3, 20, 30).toISOString(), drink: 'wine' },
    ];
    const only = buildTimeline([], journal, now, ['alcohol']);
    expect(only[0].entries.map((e) => e.id)).toEqual(['w']);
  });
});

describe('kindsPresent', () => {
  it('lists the kinds that have entries, in filter order', () => {
    const journal: JournalEntry[] = [
      { id: 'n', kind: 'note', at: new Date().toISOString(), text: 'x' },
      { id: 'c', kind: 'caffeine', at: new Date().toISOString(), drink: 'tea' },
    ];
    const ep = [episode('h', new Date(), null)];
    expect(kindsPresent(ep, journal)).toEqual(['headache', 'caffeine', 'note']);
    expect(kindsPresent([], [])).toEqual([]);
  });
});
