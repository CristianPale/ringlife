import { TestBed } from '@angular/core/testing';
import { PLAIN_STORE } from '../api/key-value-store';
import { InMemoryKeyValueStore } from '../api/testing';
import { SettingsService } from '../settings/settings.service';
import { HabitualCaffeineService } from './habitual-caffeine.service';
import { JournalService } from './journal.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('HabitualCaffeineService', () => {
  let clock: FakeClock;

  async function setup(store = new InMemoryKeyValueStore()) {
    clock = new FakeClock(new Date(2026, 10, 22, 9, 30));
    TestBed.configureTestingModule({
      providers: [...provideDiaryTesting(new InMemoryHeadacheRepository(), clock), { provide: PLAIN_STORE, useValue: store }],
    });
    const journal = TestBed.inject(JournalService);
    await journal.init();
    const service = TestBed.inject(HabitualCaffeineService);
    await service.init();
    return { service, journal, settings: TestBed.inject(SettingsService), store };
  }

  it('counts from today: once the time has passed, today has the entry right away', async () => {
    const { service, journal, settings } = await setup();
    await service.add('coffee', '08:00');
    const habit = settings.settings().habitualCaffeine[0];
    expect(habit).toEqual({ id: habit.id, drink: 'coffee', time: '08:00', since: '2026-11-22' });
    expect(journal.entries()).toEqual([
      { id: `habit-${habit.id}-20261122`, at: new Date(2026, 10, 22, 8, 0).toISOString(), kind: 'caffeine', drink: 'coffee' },
    ]);
  });

  it('adds the next day entry when the day comes, only once', async () => {
    const { service, journal } = await setup();
    await service.add('coffee', '08:00');
    clock.current = new Date(2026, 10, 23, 7, 0);
    expect(await service.apply()).toBe(0);
    clock.current = new Date(2026, 10, 23, 8, 5);
    expect(await service.apply()).toBe(1);
    expect(await service.apply()).toBe(0);
    expect(journal.entries()).toHaveLength(2);
  });

  it('does not bring back an entry taken away for a day, even after a restart', async () => {
    const { service, journal, store } = await setup();
    await service.add('coffee', '08:00');
    const id = journal.entries()[0].id;
    await service.skip(id);
    expect(journal.entries()).toEqual([]);
    expect(await service.apply()).toBe(0);

    const settingsState = TestBed.inject(SettingsService).settings();
    TestBed.resetTestingModule();
    const again = await setup(store);
    await again.settings.update({ habitualCaffeine: settingsState.habitualCaffeine });
    expect(await again.service.apply()).toBe(0);
  });

  it('keeps the entries already in the diary when the habit is removed', async () => {
    const { service, journal, settings } = await setup();
    await service.add('tea', '08:00');
    await service.remove(settings.settings().habitualCaffeine[0].id);
    expect(settings.settings().habitualCaffeine).toEqual([]);
    expect(journal.entries()).toHaveLength(1);
    clock.current = new Date(2026, 10, 23, 9, 0);
    expect(await service.apply()).toBe(0);
  });
});
