import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { HEART_RATE_KEEP_MS, HeartRateLogService } from './heart-rate-log.service';

describe('HeartRateLogService', () => {
  const NOW = Date.parse('2026-11-19T12:00:00Z');

  function create(store = new InMemoryKeyValueStore()) {
    TestBed.configureTestingModule({ providers: [{ provide: PLAIN_STORE, useValue: store }] });
    return { service: TestBed.inject(HeartRateLogService), store };
  }

  it('keeps only heart rate, oldest first, without doubles, and only the last 48 hours', async () => {
    const { service } = create();
    await service.add(
      [
        { metric: 'HR', ts: NOW - 30 * 60_000, value: 60 },
        { metric: 'TEMP', ts: NOW - 30 * 60_000, value: 36.4 },
        { metric: 'HR', ts: NOW - 60 * 60_000, value: 58 },
        { metric: 'HR', ts: NOW - HEART_RATE_KEEP_MS - 1, value: 70 },
      ],
      NOW,
    );
    await service.add([{ metric: 'HR', ts: NOW - 30 * 60_000, value: 62 }], NOW);
    expect(service.readings()).toEqual([
      { ts: NOW - 60 * 60_000, bpm: 58 },
      { ts: NOW - 30 * 60_000, bpm: 62 },
    ]);
    expect(service.latest()).toEqual({ ts: NOW - 30 * 60_000, bpm: 62 });
  });

  it('survives a restart of the app', async () => {
    const store = new InMemoryKeyValueStore();
    await create(store).service.add([{ metric: 'HR', ts: NOW, value: 57 }], NOW);
    TestBed.resetTestingModule();
    const { service } = create(store);
    await service.init();
    expect(service.latest()).toEqual({ ts: NOW, bpm: 57 });
  });
});
