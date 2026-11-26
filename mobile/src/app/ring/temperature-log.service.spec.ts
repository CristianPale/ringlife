import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { TEMPERATURE_KEEP_MS, TemperatureLogService } from './temperature-log.service';

describe('TemperatureLogService', () => {
  const NOW = Date.parse('2026-11-19T12:00:00Z');

  function create(store = new InMemoryKeyValueStore()) {
    TestBed.configureTestingModule({ providers: [{ provide: PLAIN_STORE, useValue: store }] });
    return { service: TestBed.inject(TemperatureLogService), store };
  }

  it('keeps only temperatures, oldest first, without doubles, and only the last 48 hours', async () => {
    const { service } = create();
    await service.add(
      [
        { metric: 'TEMP', ts: NOW - 30 * 60_000, value: 36.4 },
        { metric: 'HR', ts: NOW - 30 * 60_000, value: 60 },
        { metric: 'TEMP', ts: NOW - 60 * 60_000, value: 36.2 },
        { metric: 'TEMP', ts: NOW - TEMPERATURE_KEEP_MS - 1, value: 35 },
      ],
      NOW,
    );
    await service.add([{ metric: 'TEMP', ts: NOW - 30 * 60_000, value: 36.5 }], NOW);
    expect(service.readings()).toEqual([
      { ts: NOW - 60 * 60_000, celsius: 36.2 },
      { ts: NOW - 30 * 60_000, celsius: 36.5 },
    ]);
    expect(service.latest()).toEqual({ ts: NOW - 30 * 60_000, celsius: 36.5 });
  });

  it('survives a restart of the app', async () => {
    const store = new InMemoryKeyValueStore();
    await create(store).service.add([{ metric: 'TEMP', ts: NOW, value: 36.3 }], NOW);
    TestBed.resetTestingModule();
    const { service } = create(store);
    await service.init();
    expect(service.latest()).toEqual({ ts: NOW, celsius: 36.3 });
  });

  it('keeps a measure taken on demand among the readings, marked as such, also after a restart', async () => {
    const store = new InMemoryKeyValueStore();
    const first = create(store).service;
    await first.add([{ metric: 'TEMP', ts: NOW - 30 * 60_000, value: 36.2 }], NOW);
    await first.addMeasure(NOW + 60_000, 36.6);
    expect(first.latest()).toEqual({ ts: NOW + 60_000, celsius: 36.6, manual: true });
    TestBed.resetTestingModule();
    const { service } = create(store);
    await service.init();
    expect(service.readings().map((r) => r.celsius)).toEqual([36.2, 36.6]);
    expect(service.latest()?.manual).toBe(true);
  });
});
