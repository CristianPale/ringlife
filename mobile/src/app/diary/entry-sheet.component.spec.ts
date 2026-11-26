import { TestBed } from '@angular/core/testing';
import { EntryChoice, EntrySheetComponent } from './entry-sheet.component';
import { NoteChoice, NoteSheetComponent } from './note-sheet.component';
import { CAFFEINE_OPTIONS } from './journal-labels';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

function configure(now: Date) {
  const clock = new FakeClock(now);
  TestBed.configureTestingModule({ providers: provideDiaryTesting(new InMemoryHeadacheRepository(), clock) });
  return clock;
}

describe('EntrySheetComponent', () => {
  function render(now = new Date(2026, 10, 3, 15, 10)) {
    configure(now);
    const fixture = TestBed.createComponent(EntrySheetComponent);
    fixture.componentRef.setInput('title', 'Caffeina');
    fixture.componentRef.setInput('question', 'Che cosa hai preso?');
    fixture.componentRef.setInput('options', CAFFEINE_OPTIONS);
    const chosen: EntryChoice[] = [];
    let cancelled = 0;
    fixture.componentInstance.chosen.subscribe((c) => chosen.push(c));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, chosen, cancelled: () => cancelled };
  }

  it('shows the title, now, and one tile per drink', () => {
    const { root } = render();
    expect(root.querySelector('h2')?.textContent).toBe('Caffeina');
    expect(root.querySelector('.when')?.textContent).toBe('Adesso, alle 15:10');
    expect(Array.from(root.querySelectorAll('.option')).map((o) => o.textContent?.trim())).toEqual([
      'Caffè',
      'Tè',
      'Energy drink',
      'Altro',
    ]);
  });

  it('records with one tap, at the moment of the tap', () => {
    const { root, chosen } = render();
    root.querySelectorAll<HTMLButtonElement>('.option')[0].click();
    expect(chosen).toEqual([{ code: 'coffee', at: new Date(2026, 10, 3, 15, 10) }]);
  });

  it('records at a time chosen by the user', () => {
    const { fixture, root, chosen } = render();
    root.querySelector<HTMLButtonElement>('.link')!.click();
    fixture.detectChanges();
    const input = root.querySelector<HTMLInputElement>('#start-time')!;
    input.value = '09:20';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(root.querySelector('.when')?.textContent).toBe('Alle 09:20');
    root.querySelectorAll<HTMLButtonElement>('.option')[1].click();
    expect(chosen[0]).toEqual({ code: 'tea', at: new Date(2026, 10, 3, 9, 20) });
  });

  it('cancels without recording', () => {
    const { root, chosen, cancelled } = render();
    root.querySelector<HTMLButtonElement>('.cancel')!.click();
    expect(cancelled()).toBe(1);
    expect(chosen).toHaveLength(0);
  });
});

describe('NoteSheetComponent', () => {
  function render() {
    configure(new Date(2026, 10, 3, 22, 5));
    const fixture = TestBed.createComponent(NoteSheetComponent);
    const saved: NoteChoice[] = [];
    fixture.componentInstance.saved.subscribe((s) => saved.push(s));
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, saved };
  }

  function type(fixture: { detectChanges(): void }, root: HTMLElement, text: string) {
    const area = root.querySelector<HTMLTextAreaElement>('#note-text')!;
    area.value = text;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('cannot save an empty note', () => {
    const { fixture, root, saved } = render();
    expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(true);
    type(fixture, root, '   ');
    expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>('.save')!.click();
    expect(saved).toHaveLength(0);
  });

  it('saves the text with the time of the tap', () => {
    const { fixture, root, saved } = render();
    type(fixture, root, 'dormito male');
    expect(root.querySelector<HTMLButtonElement>('.save')!.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('.save')!.click();
    expect(saved).toEqual([{ text: 'dormito male', at: new Date(2026, 10, 3, 22, 5) }]);
  });
});
