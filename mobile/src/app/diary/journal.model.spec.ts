import { normalizeEntry } from './journal.model';

describe('normalizeEntry', () => {
  const at = '2026-11-03T08:20:00.000Z';

  it('accepts valid entries of each kind', () => {
    expect(normalizeEntry({ id: 'a', at, kind: 'caffeine', drink: 'coffee' })?.kind).toBe('caffeine');
    expect(normalizeEntry({ id: 'a', at, kind: 'alcohol', drink: 'wine' })?.kind).toBe('alcohol');
    expect(normalizeEntry({ id: 'a', at, kind: 'note', text: 'ciao' })?.kind).toBe('note');
  });

  it('drops anything unreadable instead of failing', () => {
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry('x')).toBeNull();
    expect(normalizeEntry({ at, kind: 'note', text: 'x' })).toBeNull();
    expect(normalizeEntry({ id: 'a', at, kind: 'unknown' })).toBeNull();
    expect(normalizeEntry({ id: 'a', at, kind: 'caffeine', drink: 'wine' })).toBeNull();
    expect(normalizeEntry({ id: 'a', at, kind: 'alcohol', drink: 'coffee' })).toBeNull();
    expect(normalizeEntry({ id: 'a', at, kind: 'note', text: '   ' })).toBeNull();
  });
});
