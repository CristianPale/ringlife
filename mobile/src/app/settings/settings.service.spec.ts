import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from './settings.model';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
import { InMemorySettingsRepository } from './testing';

describe('SettingsService', () => {
  function create(stored = DEFAULT_SETTINGS) {
    const repository = new InMemorySettingsRepository(stored);
    TestBed.configureTestingModule({ providers: [{ provide: SettingsRepository, useValue: repository }] });
    return { service: TestBed.inject(SettingsService), repository };
  }

  it('starts with the defaults and loads the saved settings on init', async () => {
    const { service } = create({ ...DEFAULT_SETTINGS, stepsGoal: 10000 });
    expect(service.settings().stepsGoal).toBe(8000);
    await service.init();
    expect(service.settings().stepsGoal).toBe(10000);
  });

  it('saves every change', async () => {
    const { service, repository } = create();
    await service.update({ theme: 'dark' });
    await service.updateRing({ stress: false });
    await service.setPlugin('migraine', false);
    expect(repository.saved).toHaveLength(3);
    const last = repository.saved[2];
    expect(last.theme).toBe('dark');
    expect(last.ring.stress).toBe(false);
    expect(last.plugins.migraine).toBe(false);
  });

  it('does not lose the other ring settings when one changes', async () => {
    const { service } = create();
    await service.updateRing({ hrIntervalMin: 15 });
    expect(service.settings().ring).toEqual({ hrIntervalMin: 15, stress: true, spo2: true, hrv: true, temperature: true });
  });

  it('never stores a value outside its limits', async () => {
    const { service, repository } = create();
    await service.update({ stepsGoal: 5 });
    await service.update({ sleepGoalMin: 20 * 60 });
    await service.update({ bedtime: 'tardi' });
    expect(service.settings().stepsGoal).toBe(1000);
    expect(service.settings().sleepGoalMin).toBe(600);
    expect(service.settings().bedtime).toBe('23:30');
    expect(repository.saved.at(-1)).toEqual(service.settings());
  });

  it('remembers when the hand or the finger changes, and only then', async () => {
    const { service, repository } = create();
    await service.updateWear({ hand: 'left' }, 100);
    expect(repository.saved).toHaveLength(0);
    await service.updateWear({ finger: 'middle' }, 200);
    expect(service.settings().wear).toEqual({ hand: 'left', finger: 'middle', changedAt: 200 });
    await service.updateWear({ hand: 'right' }, 300);
    expect(service.settings().wear).toEqual({ hand: 'right', finger: 'middle', changedAt: 300 });
  });

  it('works without a repository, for screens that only read the settings', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(SettingsService).settings()).toEqual(DEFAULT_SETTINGS);
  });
});
