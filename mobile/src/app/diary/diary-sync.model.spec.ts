import { MAX_DIARY_ENTRIES, MAX_DIARY_EPISODES } from '../api/api.model';
import {
  EMPTY_SYNCED,
  applySent,
  diffDiary,
  entryFromPayload,
  entryPayload,
  episodeFromPayload,
  episodePayload,
  restorable,
  isEmpty,
  pendingCount,
  requestsFor,
  signature,
  syncedFor,
} from './diary-sync.model';
import { EMPTY_DETAILS, HeadacheEpisode } from './headache.model';
import { JournalEntry } from './journal.model';


const entry = (id: string, at = '2026-11-02T08:00:00.000Z'): JournalEntry => ({ id, at, kind: 'caffeine', drink: 'coffee' });

const episode = (id: string, intensity = 6): HeadacheEpisode => ({
  id,
  startedAt: '2026-11-02T08:00:00.000Z',
  endedAt: null,
  intensity,
  intensityLog: [{ at: '2026-11-02T08:00:00.000Z', value: intensity }],
  medicationAt: ['2026-11-02T08:30:00.000Z'],
  details: { ...EMPTY_DETAILS, symptoms: ['nausea'], location: 'left' },
  completedAt: null,
});

describe('diary sync model', () => {
  it('turns a journal entry into the payload the server expects, with times in milliseconds', () => {
    expect(entryPayload(entry('e1'))).toEqual({ id: 'e1', ts: Date.parse('2026-11-02T08:00:00.000Z'), kind: 'caffeine', drink: 'coffee' });
    expect(entryPayload({ id: 'n1', at: '2026-11-02T08:00:00.000Z', kind: 'note', text: 'poco sonno' })).toEqual({
      id: 'n1',
      ts: Date.parse('2026-11-02T08:00:00.000Z'),
      kind: 'note',
      text: 'poco sonno',
    });
  });

  it('turns an episode into the payload, with open end and medications as milliseconds', () => {
    const payload = episodePayload(episode('h1'))!;
    expect(payload.start).toBe(Date.parse('2026-11-02T08:00:00.000Z'));
    expect(payload.end).toBeNull();
    expect(payload.completedAt).toBeNull();
    expect(payload.medicationAt).toEqual([Date.parse('2026-11-02T08:30:00.000Z')]);
    expect(payload.intensityLog).toEqual([{ at: Date.parse('2026-11-02T08:00:00.000Z'), value: 6 }]);
    expect(payload.details).toEqual({ symptoms: ['nausea'], location: 'left', medicationHelp: null, causes: [], notes: '' });
  });

  it('skips what it cannot send: an id the server would refuse, or a date it cannot read', () => {
    expect(entryPayload(entry('bad id!'))).toBeNull();
    expect(entryPayload(entry('ok', 'not a date'))).toBeNull();
    expect(episodePayload({ ...episode('x'), id: '' })).toBeNull();
    expect(episodePayload({ ...episode('x'), startedAt: 'boh' })).toBeNull();
    expect(diffDiary(EMPTY_SYNCED, [entry('bad id!')], [])).toEqual({ entries: [], episodes: [], deletedEntries: [], deletedEpisodes: [] });
  });

  it('sends everything the first time, and nothing once the server has it', () => {
    const first = diffDiary(EMPTY_SYNCED, [entry('e1')], [episode('h1')]);
    expect(first.entries).toHaveLength(1);
    expect(first.episodes).toHaveLength(1);
    const synced = applySent(EMPTY_SYNCED, first);
    expect(isEmpty(diffDiary(synced, [entry('e1')], [episode('h1')]))).toBe(true);
  });

  it('sends an episode again when it changes, and only that one', () => {
    const synced = applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1')], [episode('h1'), episode('h2')]));
    const next = diffDiary(synced, [entry('e1')], [episode('h1', 4), episode('h2')]);
    expect(next.episodes.map((e) => e.id)).toEqual(['h1']);
    expect(next.entries).toEqual([]);
  });

  it('asks the server to delete what disappeared from the phone', () => {
    const synced = applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1'), entry('e2')], [episode('h1')]));
    const next = diffDiary(synced, [entry('e2')], []);
    expect(next.deletedEntries).toEqual(['e1']);
    expect(next.deletedEpisodes).toEqual(['h1']);
    expect(next.entries).toEqual([]);
  });

  it('does not delete what it never sent', () => {
    const next = diffDiary(EMPTY_SYNCED, [], []);
    expect(isEmpty(next)).toBe(true);
  });

  it('forgets a deletion once it was sent', () => {
    const synced = applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1')], []));
    const del = diffDiary(synced, [], []);
    const after = applySent(synced, del);
    expect(after.entries).toEqual({});
    expect(isEmpty(diffDiary(after, [], []))).toBe(true);
  });

  it('counts what is still to send', () => {
    const synced = applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1')], []));
    expect(pendingCount(diffDiary(synced, [entry('e2'), entry('e3')], [episode('h1')]))).toBe(4);
  });

  it('starts from zero for another server or device, and keeps the list for the same one', () => {
    const synced = { ...applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1')], [])), target: 'https://a|dev-1' };
    expect(syncedFor(synced, 'https://a|dev-1')).toBe(synced);
    expect(syncedFor(synced, 'https://b|dev-9')).toEqual({ target: 'https://b|dev-9', entries: {}, episodes: {} });
  });

  it('splits a big difference into requests the server accepts, and loses nothing', () => {
    const entries = Array.from({ length: MAX_DIARY_ENTRIES + 5 }, (_, i) => entry(`e${i}`));
    const episodes = Array.from({ length: MAX_DIARY_EPISODES * 2 + 1 }, (_, i) => episode(`h${i}`));
    const requests = requestsFor(diffDiary(EMPTY_SYNCED, entries, episodes));
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.entries!.length).toBeLessThanOrEqual(MAX_DIARY_ENTRIES);
      expect(request.episodes!.length).toBeLessThanOrEqual(MAX_DIARY_EPISODES);
    }
    expect(requests.flatMap((r) => r.entries!)).toHaveLength(entries.length);
    expect(requests.flatMap((r) => r.episodes!)).toHaveLength(episodes.length);
  });

  it('makes no request when there is nothing to send', () => {
    expect(requestsFor(diffDiary(EMPTY_SYNCED, [], []))).toEqual([]);
  });

  it('gives two equal payloads the same signature', () => {
    expect(signature(entryPayload(entry('e1'))!)).toBe(signature(entryPayload(entry('e1'))!));
    expect(signature(entryPayload(entry('e1'))!)).not.toBe(signature(entryPayload(entry('e1', '2026-11-02T09:00:00.000Z'))!));
  });

  describe('restore', () => {
    it('turns the server payload back into the same entry and episode the phone would have', () => {
      const e = entry('e1');
      expect(entryFromPayload(entryPayload(e)!)).toEqual(e);
      const note: JournalEntry = { id: 'n1', at: '2026-11-02T08:00:00.000Z', kind: 'note', text: 'poco sonno' };
      expect(entryFromPayload(entryPayload(note)!)).toEqual(note);
      const h = episode('h1');
      expect(episodeFromPayload(episodePayload(h)!)).toEqual(h);
      const closed = { ...h, endedAt: '2026-11-02T09:30:00.000Z', completedAt: '2026-11-02T10:00:00.000Z' };
      expect(episodeFromPayload(episodePayload(closed)!)).toEqual(closed);
    });

    it('drops an entry it cannot read instead of inventing one', () => {
      expect(entryFromPayload({ id: 'x', ts: 1, kind: 'caffeine' })).toBeNull();
      expect(entryFromPayload({ id: 'x', ts: 1, kind: 'note', text: '' })).toBeNull();
      expect(entryFromPayload({ id: 'x', ts: 1, kind: 'sport' as never })).toBeNull();
    });

    const server = () => ({
      entries: [entryPayload(entry('e1'))!, entryPayload(entry('e2'))!],
      episodes: [episodePayload(episode('h1'))!],
    });

    it('brings back everything on a blank phone', () => {
      const result = restorable(server(), EMPTY_SYNCED, [], []);
      expect(result.entries.map((e) => e.id)).toEqual(['e1', 'e2']);
      expect(result.episodes.map((e) => e.id)).toEqual(['h1']);
    });

    it('leaves alone what the phone already has: the phone wins', () => {
      const result = restorable(server(), EMPTY_SYNCED, [entry('e1')], [{ ...episode('h1'), intensity: 3 }]);
      expect(result.entries.map((e) => e.id)).toEqual(['e2']);
      expect(result.episodes).toEqual([]);
    });

    it('does not bring back what the phone sent and then removed: that is a deletion still to send', () => {
      const synced = applySent(EMPTY_SYNCED, diffDiary(EMPTY_SYNCED, [entry('e1'), entry('e2')], [episode('h1')]));
      const result = restorable(server(), synced, [entry('e2')], []);
      expect(result.entries).toEqual([]);
      expect(result.episodes).toEqual([]);
    });
  });
});
