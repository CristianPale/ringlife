import { PreferencesJournalRepository } from './journal.repository';

const KEY = 'CapacitorStorage.journal.entries.v1';

describe('PreferencesJournalRepository', () => {
  const repository = new PreferencesJournalRepository();

  afterEach(() => localStorage.removeItem(KEY));

  it('returns an empty list when nothing is saved', async () => {
    expect(await repository.load()).toEqual([]);
  });

  it('round-trips entries', async () => {
    const entries = [
      { id: 'a', at: '2026-11-03T08:20:00.000Z', kind: 'caffeine' as const, drink: 'coffee' as const },
      { id: 'b', at: '2026-11-03T09:00:00.000Z', kind: 'note' as const, text: 'ciao' },
    ];
    await repository.save(entries);
    expect(await repository.load()).toEqual(entries);
  });

  it('keeps the valid entries when some are unreadable', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'a', at: '2026-11-03T08:20:00.000Z', kind: 'caffeine', drink: 'coffee' },
        { id: 'b', kind: 'note' },
        42,
      ]),
    );
    expect(await repository.load()).toHaveLength(1);
  });

  it('starts empty on unreadable data', async () => {
    localStorage.setItem(KEY, '{broken');
    expect(await repository.load()).toEqual([]);
  });
});
