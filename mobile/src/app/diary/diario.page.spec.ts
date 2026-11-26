import { TestBed } from '@angular/core/testing';
import { DiarioPage } from './diario.page';
import { HeadacheService } from './headache.service';
import { JournalService } from './journal.service';
import { HabitualCaffeineService } from './habitual-caffeine.service';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('DiarioPage', () => {
  let service: HeadacheService;
  let journal: JournalService;
  let clock: FakeClock;

  async function render() {
    clock = new FakeClock(new Date(2026, 10, 3, 7, 44));
    TestBed.configureTestingModule({
      imports: [DiarioPage],
      providers: provideDiaryTesting(new InMemoryHeadacheRepository(), clock),
    });
    service = TestBed.inject(HeadacheService);
    journal = TestBed.inject(JournalService);
    await service.init();
    await journal.init();
    const fixture = TestBed.createComponent(DiarioPage);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('starts with an empty history and nothing to complete', async () => {
    const { root } = await render();
    expect(root.querySelector('app-episode-completion')).toBeNull();
    expect(root.querySelector('.empty')?.textContent).toContain('Ancora niente');
    expect(root.querySelector('app-chip-group')).toBeNull();
  });

  it('shows an open episode in the history, without asking to complete it', async () => {
    await render();
    await service.start(4, clock.now());
    const fixture = TestBed.createComponent(DiarioPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('app-episode-completion')).toBeNull();
    expect(root.querySelector('.entries li')?.textContent).toContain('in corso');
    expect(root.querySelector('.day')?.textContent).toBe('Oggi');
  });

  it('asks to complete a finished episode, then lists it', async () => {
    const { fixture, root } = await render();
    await service.start(6, clock.now());
    clock.advanceMinutes(72);
    await service.finish();
    fixture.detectChanges();

    expect(root.querySelector('app-episode-completion')).not.toBeNull();
    expect(root.querySelector('.entries li')?.textContent).toContain('Cefalea · intensità massima 6 · 1 h 12');

    root.querySelector<HTMLButtonElement>('.skip')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('app-episode-completion')).toBeNull();
    expect(root.querySelectorAll('.entries li')).toHaveLength(1);
  });

  it('hides the filters while there is only one kind of entry', async () => {
    const { fixture, root } = await render();
    await service.start(6, clock.now());
    fixture.detectChanges();
    expect(root.querySelector('app-chip-group.filters')).toBeNull();
  });

  it('lists caffeine, alcohol and notes, and shows filters once there are two kinds', async () => {
    const { fixture, root } = await render();
    await journal.addCaffeine('coffee', new Date(2026, 10, 3, 6, 30));
    fixture.detectChanges();
    expect(root.querySelector('app-chip-group.filters')).toBeNull();

    await journal.addAlcohol('wine', new Date(2026, 10, 3, 7, 0));
    await journal.addNote('dormito male', new Date(2026, 10, 3, 7, 30));
    fixture.detectChanges();

    const filters = Array.from(root.querySelectorAll('app-chip-group.filters button')).map((b) => b.textContent?.trim());
    expect(filters).toEqual(['Tutto', 'Caffeina', 'Alcol', 'Note']);
    expect(Array.from(root.querySelectorAll('.entries li .text')).map((t) => t.textContent)).toEqual([
      'Nota · dormito male',
      'Alcol · 1 bicchiere di vino',
      'Caffeina · 1 caffè',
    ]);
  });

  it('filters the history by kind and back to everything', async () => {
    const { fixture, root } = await render();
    await journal.addCaffeine('coffee', new Date(2026, 10, 3, 6, 30));
    await journal.addAlcohol('beer', new Date(2026, 10, 3, 7, 0));
    fixture.detectChanges();

    const button = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('app-chip-group.filters button')).find(
        (b) => b.textContent?.trim() === label,
      )!;
    button('Alcol').click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.entries li .text')).map((t) => t.textContent)).toEqual([
      'Alcol · 1 birra',
    ]);

    button('Alcol').click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.entries li')).toHaveLength(2);
  });

  it('marks the habitual caffeine and lets you take it away for that day', async () => {
    const { fixture, root } = await render();
    const habits = TestBed.inject(HabitualCaffeineService);
    await habits.add('coffee', '07:30');
    fixture.detectChanges();
    const item = root.querySelector('.entries li.habitual');
    expect(item?.textContent).toContain('Caffeina · 1 caffè');
    expect(item?.querySelector('.habit-note')?.textContent).toBe('abituale, segnata da sola');
    const button = item?.querySelector<HTMLButtonElement>('.habit-skip');
    expect(button?.getAttribute('aria-label')).toBe('Togli Caffeina · 1 caffè, Oggi');
    button!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(journal.entries()).toEqual([]);
    expect(root.querySelector('.entries li.habitual')).toBeNull();
  });
});
