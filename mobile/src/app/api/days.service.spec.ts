import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DayView } from './api.model';
import { CredentialsService } from './credentials.service';
import { DAYS_CACHE_KEY, DaysService } from './days.service';
import { PLAIN_STORE } from './key-value-store';
import { RingLifeApi } from './ringlife-api';
import { InMemoryKeyValueStore } from './testing';
import { SettingsService } from '../settings/settings.service';

const day = (key: string, sleep: number): DayView =>
  ({
    day: key,
    scores: { sleep: { value: sleep, components: {}, algoVersion: 'v1' } },
    metrics: {},
  }) as unknown as DayView;

describe('DaysService', () => {
  function setup(
    store = new InMemoryKeyValueStore(),
    deviceId = 'dev-1',
    getDays: () => Promise<DayView[]> = async () => [],
  ) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLAIN_STORE, useValue: store },
        { provide: RingLifeApi, useValue: { getDays: vi.fn(getDays) } },
        { provide: CredentialsService, useValue: { paired: signal({ deviceId, token: 't' }) } },
        {
          provide: SettingsService,
          useValue: { settings: signal({ serverUrl: 'https://casa.example' }) },
        },
      ],
    });
    return { service: TestBed.inject(DaysService), store };
  }

  it('keeps the downloaded days on the phone and shows them at the next opening, before the server answers', async () => {
    const now = new Date('2026-11-24T07:00:00Z');
    const first = setup(undefined, 'dev-1', async () => [
      day('2026-11-24', 80),
      day('2026-11-23', 70),
    ]);
    await first.service.refresh(now);
    expect(first.service.days().map((d) => d.day)).toEqual(['2026-11-23', '2026-11-24']);
    expect(first.service.reachable()).toBe(true);
    expect(first.store.values.has(DAYS_CACHE_KEY)).toBe(true);

    const again = setup(first.store, 'dev-1', async () => {
      throw new Error('offline');
    });
    await again.service.init();
    expect(again.service.days().map((d) => d.day)).toEqual(['2026-11-23', '2026-11-24']);
    expect(again.service.fetchedAt()).toBe(now.getTime());
    expect(again.service.reachable()).toBeNull();

    await again.service.refresh(new Date('2026-11-25T07:00:00Z'));
    expect(again.service.reachable()).toBe(false);
    expect(again.service.days()).toHaveLength(2);
    expect(again.service.fetchedAt()).toBe(now.getTime());
  });

  it('ignores the days saved for another device', async () => {
    const first = setup(undefined, 'dev-1', async () => [day('2026-11-24', 80)]);
    await first.service.refresh(new Date('2026-11-24T07:00:00Z'));
    const other = setup(first.store, 'dev-2');
    await other.service.init();
    expect(other.service.days()).toEqual([]);
    expect(other.service.fetchedAt()).toBeNull();
  });

  it('treats an unreadable cache as missing', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set(DAYS_CACHE_KEY, '{rotto');
    const { service } = setup(store);
    await service.init();
    expect(service.days()).toEqual([]);
  });
});
