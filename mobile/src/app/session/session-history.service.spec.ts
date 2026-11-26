import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { MAX_SESSIONS, SessionHistoryService, perSecond, sessionSummary } from './session-history.service';

describe('SessionHistoryService', () => {
  function setup(store = new InMemoryKeyValueStore()) {
    TestBed.configureTestingModule({ providers: [{ provide: PLAIN_STORE, useValue: store }] });
    return { history: TestBed.inject(SessionHistoryService), store };
  }

  it('keeps one value per second (the mean of that second)', () => {
    expect(
      perSecond([
        { t: 100, bpm: 70 },
        { t: 600, bpm: 72 },
        { t: 1_200, bpm: 68 },
      ]),
    ).toEqual([
      { t: 0, bpm: 71 },
      { t: 1_000, bpm: 68 },
    ]);
  });

  it('saves a finished session, newest first, and reloads it', async () => {
    const { history, store } = setup();
    await history.add('respirazione', 1_000, 60_000, [{ t: 0, bpm: 70 }]);
    await history.add('allenamento', 9_000, 30_000, [{ t: 0, bpm: 120 }]);
    expect(history.sessions().map((s) => s.mode)).toEqual(['allenamento', 'respirazione']);
    expect(history.lastTraining()?.start).toBe(9_000);
    expect(history.lastBreathing()?.start).toBe(1_000);

    TestBed.resetTestingModule();
    const again = setup(store).history;
    await again.init();
    expect(again.sessions()).toHaveLength(2);
  });

  it('does not save a session without heart rate, and keeps at most the latest sessions', async () => {
    const { history } = setup();
    expect(await history.add('allenamento', 1, 1, [])).toBeNull();
    for (let i = 0; i < MAX_SESSIONS + 3; i++) {
      await history.add('allenamento', i * 1000, 1000, [{ t: 0, bpm: 100 }]);
    }
    expect(history.sessions()).toHaveLength(MAX_SESSIONS);
  });

  it('removes a session', async () => {
    const { history } = setup();
    const saved = await history.add('allenamento', 5, 1000, [{ t: 0, bpm: 100 }]);
    await history.remove(saved!.id);
    expect(history.sessions()).toEqual([]);
  });

  it('summarises a session in one line, with the activity when there is one', () => {
    const samples = [
      { t: 0, bpm: 100 },
      { t: 1_000, bpm: 140 },
    ];
    expect(sessionSummary({ id: 'a', mode: 'allenamento', start: 0, durationMs: 300_000, samples })).toBe('5 min · media 120, massimo 140');
    expect(sessionSummary({ id: 'a', mode: 'allenamento', start: 0, durationMs: 300_000, samples, activity: 'corsa' })).toBe(
      'Corsa, 5 min · media 120, massimo 140',
    );
  });

  it('keeps what the training adds: activity, target zone, calories and recovery', async () => {
    const { history, store } = setup();
    await history.add('allenamento', 1, 60_000, [{ t: 0, bpm: 120 }], {
      activity: 'bici',
      targetZone: 3,
      kcal: 42,
      recovery: { end: 140, after: 118 },
    });
    TestBed.resetTestingModule();
    const again = setup(store).history;
    await again.init();
    expect(again.sessions()[0]).toMatchObject({ activity: 'bici', targetZone: 3, kcal: 42, recovery: { end: 140, after: 118 } });
  });

  it('reads the old heart-rate monitoring sessions as trainings, with no activity', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set(
      'sessions.v1',
      JSON.stringify([
        { id: 'a', mode: 'battito', start: 2, durationMs: 1, samples: [{ t: 0, bpm: 90 }] },
        { id: 'b', mode: 'allenamento', start: 1, durationMs: 1, samples: [{ t: 0, bpm: 90 }], activity: 'nuoto' },
      ]),
    );
    const { history } = setup(store);
    await history.init();
    expect(history.sessions().map((s) => s.mode)).toEqual(['allenamento', 'allenamento']);
    expect(history.sessions()[1].activity).toBeUndefined();
    expect(history.trainings()).toHaveLength(2);
  });
});
