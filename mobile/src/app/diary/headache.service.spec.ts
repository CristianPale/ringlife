import { TestBed } from '@angular/core/testing';
import { HeadacheService } from './headache.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('HeadacheService', () => {
  let repository: InMemoryHeadacheRepository;
  let clock: FakeClock;
  let service: HeadacheService;

  beforeEach(async () => {
    repository = new InMemoryHeadacheRepository();
    clock = new FakeClock(new Date('2026-11-03T07:44:00Z'));
    TestBed.configureTestingModule({ providers: provideDiaryTesting(repository, clock) });
    service = TestBed.inject(HeadacheService);
    await service.init();
  });

  it('starts with no active episode', () => {
    expect(service.active()).toBeNull();
    expect(service.episodes()).toEqual([]);
  });

  it('opens an episode with the chosen intensity and start, and saves it', async () => {
    const episode = await service.start(6, new Date('2026-11-03T07:30:00Z'));

    expect(service.active()?.id).toBe(episode.id);
    expect(episode.intensity).toBe(6);
    expect(episode.startedAt).toBe('2026-11-03T07:30:00.000Z');
    expect(episode.endedAt).toBeNull();
    expect(episode.intensityLog).toEqual([{ at: '2026-11-03T07:30:00.000Z', value: 6 }]);
    expect(repository.saved).toHaveLength(1);
  });

  it('never opens a second episode while one is open', async () => {
    const first = await service.start(4, new Date('2026-11-03T07:30:00Z'));
    const second = await service.start(9, new Date('2026-11-03T07:40:00Z'));

    expect(second.id).toBe(first.id);
    expect(service.episodes()).toHaveLength(1);
    expect(service.active()?.intensity).toBe(4);
  });

  it('clamps the starting intensity to 1-10', async () => {
    const episode = await service.start(42, clock.now());
    expect(episode.intensity).toBe(10);
  });

  it('changes intensity by one step, keeps a log and stays within 1-10', async () => {
    await service.start(10, clock.now());
    await service.adjustIntensity(1);
    expect(service.active()?.intensity).toBe(10);
    expect(service.active()?.intensityLog).toHaveLength(1);

    clock.advanceMinutes(15);
    await service.adjustIntensity(-1);
    expect(service.active()?.intensity).toBe(9);
    expect(service.active()?.intensityLog.at(-1)).toEqual({ at: '2026-11-03T07:59:00.000Z', value: 9 });
  });

  it('records the time of a medication, without name or dose', async () => {
    await service.start(6, clock.now());
    clock.advanceMinutes(14);
    await service.addMedication();

    expect(service.active()?.medicationAt).toEqual(['2026-11-03T07:58:00.000Z']);
  });

  it('finishing closes the episode and frees the slot for a new one', async () => {
    const first = await service.start(6, clock.now());
    clock.advanceMinutes(72);
    await service.finish();

    expect(service.active()).toBeNull();
    expect(service.episodes()[0].endedAt).toBe('2026-11-03T08:56:00.000Z');

    const next = await service.start(3, clock.now());
    expect(next.id).not.toBe(first.id);
    expect(service.episodes()).toHaveLength(2);
  });

  it('ignores changes when there is no open episode', async () => {
    await service.adjustIntensity(1);
    await service.addMedication();
    await service.finish();
    expect(repository.saved).toHaveLength(0);
  });

  it('restores an open episode after a restart', async () => {
    await service.start(7, clock.now());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: provideDiaryTesting(repository, clock) });
    const restarted = TestBed.inject(HeadacheService);
    await restarted.init();

    expect(restarted.active()?.intensity).toBe(7);
  });

  describe('completion', () => {
    it('asks to complete the latest finished episode, not an open one', async () => {
      await service.start(6, clock.now());
      expect(service.pendingCompletion()).toBeNull();

      clock.advanceMinutes(72);
      await service.finish();
      expect(service.pendingCompletion()?.endedAt).toBe('2026-11-03T08:56:00.000Z');
    });

    it('saves the details and stops asking', async () => {
      const episode = await service.start(6, clock.now());
      clock.advanceMinutes(72);
      await service.finish();

      await service.complete(episode.id, {
        symptoms: ['nausea'],
        location: 'right',
        medicationHelp: null,
        causes: ['weather'],
        notes: 'dopo cena',
      });

      expect(service.pendingCompletion()).toBeNull();
      const saved = service.episodes()[0];
      expect(saved.details.symptoms).toEqual(['nausea']);
      expect(saved.details.notes).toBe('dopo cena');
      expect(saved.completedAt).toBe('2026-11-03T08:56:00.000Z');
    });

    it('does not complete an episode that is still open, or an unknown one', async () => {
      const open = await service.start(6, clock.now());
      await service.complete(open.id, { symptoms: ['aura'], location: null, medicationHelp: null, causes: [], notes: '' });
      await service.complete('missing', { symptoms: [], location: null, medicationHelp: null, causes: [], notes: '' });

      expect(service.active()?.details.symptoms).toEqual([]);
      expect(service.active()?.completedAt).toBeNull();
    });

    it('with two unfinished episodes asks about the most recent one', async () => {
      const first = await service.start(3, clock.now());
      clock.advanceMinutes(30);
      await service.finish();
      clock.advanceMinutes(600);
      const second = await service.start(5, clock.now());
      clock.advanceMinutes(30);
      await service.finish();

      expect(service.pendingCompletion()?.id).toBe(second.id);
      expect(service.pendingCompletion()?.id).not.toBe(first.id);
    });
  });
});
