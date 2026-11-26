import { normalizeSynced } from './diary-sync.repository';

describe('normalizeSynced', () => {
  it('reads an empty list from anything unreadable', () => {
    for (const raw of [null, 'x', 5, undefined]) {
      expect(normalizeSynced(raw)).toEqual({ target: '', entries: {}, episodes: {} });
    }
  });

  it('keeps the readable parts and drops the rest', () => {
    expect(normalizeSynced({ target: 't', entries: { a: 'sig', b: 3 }, episodes: 'x' })).toEqual({
      target: 't',
      entries: { a: 'sig' },
      episodes: {},
    });
  });
});
