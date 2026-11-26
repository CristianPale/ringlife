import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { ManualMeasureLogService } from './manual-measure-log.service';

describe('ManualMeasureLogService', () => {
  const NOW = Date.parse('2026-11-23T15:47:00Z');

  function create(store = new InMemoryKeyValueStore()) {
    TestBed.configureTestingModule({ providers: [{ provide: PLAIN_STORE, useValue: store }] });
    return { service: TestBed.inject(ManualMeasureLogService), store };
  }

  it('keeps the last measure of each kind, also after a restart', async () => {
    const store = new InMemoryKeyValueStore();
    const first = create(store).service;
    await first.record('spo2', NOW - 60_000, 96);
    await first.record('spo2', NOW, 97);
    await first.record('hrv', NOW, 48);
    TestBed.resetTestingModule();
    const { service } = create(store);
    await service.init();
    expect(service.measures()).toEqual({ spo2: { ts: NOW, value: 97 }, hrv: { ts: NOW, value: 48 } });
  });

  it('ignores what it cannot read', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set('ring-manual.v1', JSON.stringify({ spo2: { ts: 'x', value: 1 }, other: { ts: 1, value: 2 } }));
    const { service } = create(store);
    await service.init();
    expect(service.measures()).toEqual({});
  });
});
