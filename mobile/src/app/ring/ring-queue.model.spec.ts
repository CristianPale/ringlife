import { SamplePayload, SleepSessionPayload } from '../api/api.model';
import { BATCH_SAMPLES, EMPTY_QUEUE, MAX_BATCHES, enqueue, markSent, normalizeQueue, pendingCount, sameRingSettings, sinceOf } from './ring-queue.model';

const hr = (ts: number, value = 60): SamplePayload => ({ metric: 'HR', ts, value });
const night = (start: number, end: number): SleepSessionPayload => ({ start, end, stages: [] });

describe('ring queue', () => {
  it('tracks how far each metric and the sleep have been read', () => {
    const queue = enqueue(
      EMPTY_QUEUE,
      { samples: [hr(10), hr(30), { metric: 'STEPS', ts: 20, value: 500 }], sessions: [night(0, 50)] },
      0,
    );
    expect(queue.cursors).toEqual({ HR: 30, STEPS: 20, sleep: 50 });
  });

  it('asks the ring from the furthest-behind position, so a slower metric loses nothing', () => {
    expect(sinceOf(EMPTY_QUEUE)).toBeNull();
    const queue = enqueue(EMPTY_QUEUE, { samples: [hr(90), { metric: 'STEPS', ts: 40, value: 500 }], sessions: [] }, 0);
    expect(sinceOf(queue)).toBe(40);
    // Il battito è già oltre 40: ciò che l'anello ridà tra 40 e 90 non si rimette; i passi nuovi sì.
    const next = enqueue(queue, { samples: [hr(60), hr(95), { metric: 'STEPS', ts: 70, value: 600 }], sessions: [] }, 0);
    // Stesso fuso: la lettura nuova si unisce all'ultimo lotto.
    expect(next.batches[0].samples).toEqual([hr(90), { metric: 'STEPS', ts: 40, value: 500 }, hr(95), { metric: 'STEPS', ts: 70, value: 600 }]);
  });

  it('adds a reading with the offset used at that moment', () => {
    const queue = enqueue(EMPTY_QUEUE, { samples: [hr(10)], sessions: [] }, 60);
    expect(queue.batches).toEqual([{ tzOffsetMin: 60, samples: [hr(10)], sessions: [] }]);
    expect(queue.cursors).toEqual({ HR: 10 });
    expect(pendingCount(queue)).toBe(1);
  });

  it('does not queue twice what is already waiting', () => {
    const first = enqueue(EMPTY_QUEUE, { samples: [hr(10), hr(20)], sessions: [night(0, 5)] }, 60);
    const second = enqueue(first, { samples: [hr(20), hr(30)], sessions: [night(0, 5)] }, 60);
    expect(second.batches).toHaveLength(1);
    expect(second.batches[0].samples).toEqual([hr(10), hr(20), hr(30)]);
    expect(second.batches[0].sessions).toEqual([night(0, 5)]);
    expect(pendingCount(second)).toBe(4);
  });

  it('does not queue again what lies before the position, even after it was sent', () => {
    const sent = { ...enqueue(EMPTY_QUEUE, { samples: [hr(10), hr(20)], sessions: [night(0, 25)] }, 0), batches: [] };
    const again = enqueue(sent, { samples: [hr(10), hr(20), hr(30)], sessions: [night(0, 25), night(40, 60)] }, 0);
    expect(again.batches[0].samples).toEqual([hr(30)]);
    expect(again.batches[0].sessions).toEqual([night(40, 60)]);
  });

  it('queues again a night that grew after being read while still going, in place of the short one', () => {
    // Lettura in background alle 2: la notte iniziata a 0 arriva fino a 110. Inviata.
    const sent = { ...enqueue(EMPTY_QUEUE, { samples: [], sessions: [night(0, 110)] }, 60), batches: [] };
    // Al mattino l'anello dà la stessa notte intera: si rimanda.
    const morning = enqueue(sent, { samples: [], sessions: [night(0, 480)] }, 60);
    expect(morning.batches[0].sessions).toEqual([night(0, 480)]);
    expect(morning.nights).toEqual({ '0': 480 });
    // Una lettura dopo non la rimanda più.
    expect(enqueue({ ...morning, batches: [] }, { samples: [], sessions: [night(0, 480)] }, 60).batches).toEqual([]);
  });

  it('replaces the short copy of a night still waiting to be sent', () => {
    const waiting = enqueue(EMPTY_QUEUE, { samples: [hr(10)], sessions: [night(0, 110)] }, 60);
    const morning = enqueue(waiting, { samples: [], sessions: [night(0, 480)] }, 60);
    expect(morning.batches.flatMap((b) => b.sessions)).toEqual([night(0, 480)]);
    expect(morning.batches[0].samples).toEqual([hr(10)]);
    expect(pendingCount(morning)).toBe(2);
  });

  it('never lets a shorter copy of a night replace the longer one', () => {
    const queue = enqueue(EMPTY_QUEUE, { samples: [], sessions: [night(0, 480)] }, 60);
    const late = enqueue(queue, { samples: [], sessions: [night(0, 110)] }, 60);
    expect(late.batches.flatMap((b) => b.sessions)).toEqual([night(0, 480)]);
  });

  it('sends again the nights the ring still has when the saved queue predates the night tracking', () => {
    const old = normalizeQueue({ batches: [], cursors: { sleep: 480 }, last: null });
    expect(old.nights).toEqual({});
    expect(enqueue(old, { samples: [], sessions: [night(0, 480)] }, 60).batches[0].sessions).toEqual([night(0, 480)]);
  });

  it('forgets nights older than two weeks', () => {
    const day = 86_400_000;
    const queue = enqueue(EMPTY_QUEUE, { samples: [], sessions: [night(0, 10), night(20 * day, 20 * day + 10)] }, 0);
    expect(Object.keys(queue.nights)).toEqual([String(20 * day)]);
  });

  it('keeps the same instant of a different metric', () => {
    const first = enqueue(EMPTY_QUEUE, { samples: [hr(10)], sessions: [] }, 0);
    const second = enqueue(first, { samples: [{ metric: 'SPO2', ts: 10, value: 97 }], sessions: [] }, 0);
    expect(pendingCount(second)).toBe(2);
  });

  it('moves the cursor even when nothing new is queued, never backwards', () => {
    const first = enqueue(EMPTY_QUEUE, { samples: [hr(10), hr(40)], sessions: [] }, 0);
    const again = enqueue(first, { samples: [hr(10)], sessions: [] }, 0);
    expect(again.batches).toHaveLength(1);
    expect(again.cursors).toEqual({ HR: 40 });
  });

  it('joins the readings with the same time zone in one batch, so days without server do not fill the queue', () => {
    let queue = EMPTY_QUEUE;
    // Tre giorni di letture ogni ora senza server: prima erano 72 lotti, oltre il tetto di 60.
    for (let i = 0; i < 72; i++) {
      queue = enqueue(queue, { samples: [hr(i)], sessions: [] }, 60);
    }
    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0].samples).toHaveLength(72);
    queue = enqueue(queue, { samples: [hr(100)], sessions: [] }, 120);
    expect(queue.batches.map((b) => [b.tzOffsetMin, b.samples.length])).toEqual([
      [60, 72],
      [120, 1],
    ]);
  });

  it('keeps every batch under the server limit, splitting a big reading', () => {
    const samples = Array.from({ length: BATCH_SAMPLES * 2 + 10 }, (_, i) => hr(i));
    const queue = enqueue(enqueue(EMPTY_QUEUE, { samples: [hr(-1)], sessions: [] }, 0), { samples, sessions: [] }, 0);
    expect(queue.batches.map((b) => b.samples.length)).toEqual([BATCH_SAMPLES, BATCH_SAMPLES, 11]);
    expect(queue.batches[0].samples[0].ts).toBe(-1);
  });

  it('drops the oldest batches beyond the cap', () => {
    let queue = EMPTY_QUEUE;
    // Fusi che cambiano a ogni lettura: è l'unico modo di avere un lotto per lettura.
    for (let i = 0; i < MAX_BATCHES + 5; i++) {
      queue = enqueue(queue, { samples: [hr(i)], sessions: [] }, i % 2 === 0 ? 0 : 60);
    }
    expect(queue.batches).toHaveLength(MAX_BATCHES);
    expect(queue.batches[0].samples[0].ts).toBe(5);
  });

  it('removes what the server confirmed and the batches left empty', () => {
    const queue = enqueue(EMPTY_QUEUE, { samples: [hr(10)], sessions: [night(0, 5)] }, 0);
    const afterSamples = markSent(queue, 0, { samples: true });
    expect(afterSamples.batches[0].samples).toEqual([]);
    expect(afterSamples.batches[0].sessions).toHaveLength(1);
    expect(markSent(afterSamples, 0, { sessions: true }).batches).toEqual([]);
  });

  it('reads back what it saved and discards what does not fit', () => {
    const queue = enqueue(EMPTY_QUEUE, { samples: [hr(10)], sessions: [] }, 60);
    const saved = { ...queue, last: { at: 5, battery: 70, firmware: null } };
    expect(normalizeQueue(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(normalizeQueue(null)).toEqual(EMPTY_QUEUE);
    expect(
      normalizeQueue({ batches: [{ nope: true }, saved.batches[0]], cursors: { HR: 'x', STEPS: 5 }, last: { at: 'x' }, nights: { '1': 'x', '2': 9 } }),
    ).toEqual({
      batches: saved.batches,
      cursors: { STEPS: 5 },
      last: null,
      applied: null,
      nights: { '2': 9 },
    });
  });

  it('compares the settings the ring received with the ones wanted', () => {
    const wanted = { hrIntervalMin: 5, stress: true, spo2: false, hrv: true, temperature: true };
    expect(sameRingSettings(null, wanted)).toBe(false);
    expect(sameRingSettings({ ...wanted }, wanted)).toBe(true);
    expect(sameRingSettings({ ...wanted, hrIntervalMin: 10 }, wanted)).toBe(false);
    expect(sameRingSettings({ ...wanted, spo2: true }, wanted)).toBe(false);
  });

  it('keeps the settings the ring received and drops them when they do not fit', () => {
    const applied = { hrIntervalMin: 5, stress: true, spo2: false, hrv: true, temperature: true };
    expect(normalizeQueue({ applied }).applied).toEqual(applied);
    expect(normalizeQueue({ applied: { hrIntervalMin: '5' } }).applied).toBeNull();
    expect(normalizeQueue({}).applied).toBeNull();
  });
});
