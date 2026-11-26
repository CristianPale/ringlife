import { TestBed } from '@angular/core/testing';
import { HeadacheSheetComponent, HeadacheStart, OtherEntry } from './headache-sheet.component';
import { FakeClock, InMemoryHeadacheRepository, provideDiaryTesting } from './testing';

describe('HeadacheSheetComponent', () => {
  let clock: FakeClock;

  function render(now: Date) {
    clock = new FakeClock(now);
    TestBed.configureTestingModule({ providers: provideDiaryTesting(new InMemoryHeadacheRepository(), clock) });
    const fixture = TestBed.createComponent(HeadacheSheetComponent);
    const started: HeadacheStart[] = [];
    let cancelled = 0;
    fixture.componentInstance.started.subscribe((s) => started.push(s));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, started, cancelled: () => cancelled };
  }

  it('offers ten intensity buttons with accessible names', () => {
    const { root } = render(new Date(2026, 10, 3, 7, 44));
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.level'));
    expect(buttons).toHaveLength(10);
    expect(buttons[0].getAttribute('aria-label')).toBe('Intensità 1, lieve');
    expect(buttons[4].getAttribute('aria-label')).toBe('Intensità 5, moderata');
    expect(buttons[9].getAttribute('aria-label')).toBe('Intensità 10, la peggiore');
    expect(buttons[2].getAttribute('aria-label')).toBe('Intensità 3');
  });

  it('says the episode starts now', () => {
    const { root } = render(new Date(2026, 10, 3, 7, 44));
    expect(root.querySelector('.when')?.textContent).toContain('Inizio adesso, alle 07:44');
  });

  it('opens the episode with one tap, starting now', () => {
    const { root, started } = render(new Date(2026, 10, 3, 7, 44));
    root.querySelectorAll<HTMLButtonElement>('.level')[5].click();

    expect(started).toHaveLength(1);
    expect(started[0].intensity).toBe(6);
    expect(started[0].startedAt).toEqual(new Date(2026, 10, 3, 7, 44));
  });

  it('lets the user change the start time before the tap', () => {
    const { fixture, root, started } = render(new Date(2026, 10, 3, 7, 44));
    root.querySelector<HTMLButtonElement>('.link')!.click();
    fixture.detectChanges();

    const input = root.querySelector<HTMLInputElement>('#start-time')!;
    expect(input.value).toBe('07:44');
    input.value = '06:15';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(root.querySelector('.when')?.textContent).toContain('Inizio alle 06:15');
    root.querySelectorAll<HTMLButtonElement>('.level')[2].click();
    expect(started[0].startedAt).toEqual(new Date(2026, 10, 3, 6, 15));
  });

  it('reads a time later than now as yesterday', () => {
    const { fixture, root, started } = render(new Date(2026, 10, 3, 0, 10));
    root.querySelector<HTMLButtonElement>('.link')!.click();
    fixture.detectChanges();

    const input = root.querySelector<HTMLInputElement>('#start-time')!;
    input.value = '23:30';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(root.querySelector('.when')?.textContent).toContain('Inizio ieri alle 23:30');
    root.querySelectorAll<HTMLButtonElement>('.level')[0].click();
    expect(started[0].startedAt).toEqual(new Date(2026, 10, 2, 23, 30));
  });

  it('cancels without starting', () => {
    const { root, started, cancelled } = render(new Date(2026, 10, 3, 7, 44));
    root.querySelector<HTMLButtonElement>('.cancel')!.click();
    expect(cancelled()).toBe(1);
    expect(started).toHaveLength(0);
  });

  it('offers Caffeina, Alcol and Nota under the intensity, and tells which one was chosen', () => {
    const { fixture, root, started } = render(new Date(2026, 10, 3, 7, 44));
    const chosen: OtherEntry[] = [];
    fixture.componentInstance.other.subscribe((kind) => chosen.push(kind));
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.other'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Caffeina', 'Alcol', 'Nota']);
    buttons.forEach((b) => b.click());
    expect(chosen).toEqual(['caffeine', 'alcohol', 'note']);
    // Scegliere altro non apre un episodio.
    expect(started).toHaveLength(0);
  });

  it('can hide the other entries', () => {
    const { fixture, root } = render(new Date(2026, 10, 3, 7, 44));
    fixture.componentRef.setInput('showOthers', false);
    fixture.detectChanges();
    expect(root.querySelector('.others')).toBeNull();
  });
});
