import { TestBed } from '@angular/core/testing';
import { JournalService } from './journal.service';
import { FakeClock, InMemoryHeadacheRepository, InMemoryJournalRepository, provideDiaryTesting } from './testing';

describe('JournalService', () => {
  let repository: InMemoryJournalRepository;
  let service: JournalService;
  const at = new Date('2026-11-03T08:20:00Z');

  beforeEach(async () => {
    repository = new InMemoryJournalRepository();
    TestBed.configureTestingModule({
      providers: provideDiaryTesting(new InMemoryHeadacheRepository(), new FakeClock(at), repository),
    });
    service = TestBed.inject(JournalService);
    await service.init();
  });

  it('records one entry per tap, with the time given', async () => {
    const entry = await service.addCaffeine('coffee', at);
    expect(entry).toMatchObject({ kind: 'caffeine', drink: 'coffee', at: '2026-11-03T08:20:00.000Z' });
    await service.addCaffeine('coffee', at);
    expect(service.entries()).toHaveLength(2);
    expect(service.entries()[0].id).not.toBe(service.entries()[1].id);
    expect(repository.saved).toHaveLength(2);
  });

  it('records alcohol', async () => {
    await service.addAlcohol('beer', at);
    expect(service.entries()[0]).toMatchObject({ kind: 'alcohol', drink: 'beer' });
  });

  it('trims a note, and refuses an empty one', async () => {
    expect(await service.addNote('   ', at)).toBeNull();
    expect(service.entries()).toHaveLength(0);

    const entry = await service.addNote('  dormito male  ', at);
    expect(entry).toMatchObject({ kind: 'note', text: 'dormito male' });
  });

  it('cuts a note longer than the limit', async () => {
    const entry = await service.addNote('x'.repeat(1500), at);
    expect(entry && entry.kind === 'note' && entry.text.length).toBe(1000);
  });

  it('removes an entry for «Annulla»', async () => {
    const entry = await service.addCaffeine('tea', at);
    await service.remove(entry.id);
    expect(service.entries()).toHaveLength(0);
    expect(repository.saved.at(-1)).toEqual([]);
  });

  it('ignores the removal of an unknown entry', async () => {
    await service.addCaffeine('tea', at);
    await service.remove('missing');
    expect(service.entries()).toHaveLength(1);
    expect(repository.saved).toHaveLength(1);
  });

  it('restores entries after a restart', async () => {
    await service.addAlcohol('wine', at);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: provideDiaryTesting(new InMemoryHeadacheRepository(), new FakeClock(at), repository),
    });
    const restarted = TestBed.inject(JournalService);
    await restarted.init();
    expect(restarted.entries()).toHaveLength(1);
  });
});
