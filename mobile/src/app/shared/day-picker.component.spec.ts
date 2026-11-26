import { TestBed } from '@angular/core/testing';
import { DayPickerComponent } from './day-picker.component';

describe('DayPickerComponent', () => {
  function render(days: string[], selected: string | null, label: string | null = 'Notte da lunedì a martedì') {
    const fixture = TestBed.createComponent(DayPickerComponent);
    fixture.componentRef.setInput('days', days);
    fixture.componentRef.setInput('selected', selected);
    fixture.componentRef.setInput('label', label);
    const emitted: (string | null)[] = [];
    fixture.componentInstance.changed.subscribe((day) => emitted.push(day));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { fixture, root, emitted, button };
  }

  const DAYS = ['2026-11-15', '2026-11-16', '2026-11-17'];

  it('goes back from the latest day and cannot go forward past it', () => {
    const { root, emitted, button } = render(DAYS, null);
    expect(root.querySelector('.label')?.textContent).toBe('Notte da lunedì a martedì');
    expect(button('Giorno successivo').disabled).toBe(true);
    expect(root.querySelector('.latest')).toBeNull();
    button('Giorno precedente').click();
    expect(emitted).toEqual(['2026-11-16']);
  });

  it('comes forward to the latest day as «no choice», and offers a way back to it', () => {
    const { root, emitted, button } = render(DAYS, '2026-11-16');
    button('Giorno successivo').click();
    root.querySelector<HTMLButtonElement>('.latest')!.click();
    expect(emitted).toEqual([null, null]);
  });

  it('stops at the oldest day', () => {
    const { button } = render(DAYS, '2026-11-15');
    expect(button('Giorno precedente').disabled).toBe(true);
  });

  it('shows the date of the day shown, with the line of the page under it', () => {
    const { root } = render(DAYS, '2026-11-16');
    expect(root.querySelector('.date')?.textContent?.trim()).toBe('Lunedì 16 novembre');
    expect(root.querySelector('.label')?.textContent).toBe('Notte da lunedì a martedì');
  });

  it('says «oggi» or «ieri» before the date, and leaves out the line when the page has none', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
    const { root } = render(['2026-01-01', today], null, null);
    expect(root.querySelector('.date')?.textContent?.trim()).toMatch(/^Oggi, \S+ \d+ \S+$/);
    expect(root.querySelector('.label')).toBeNull();
  });

  it('opens the calendar from the date, and a day picked there is the one shown (the latest as «no choice»)', () => {
    const { fixture, root, emitted } = render(DAYS, '2026-11-15');
    const picker = fixture.componentInstance as unknown as { open: () => boolean; pick: (day: string) => void };
    const button = root.querySelector<HTMLButtonElement>('.open')!;
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    button.click();
    expect(picker.open()).toBe(true);
    picker.pick('2026-11-16');
    expect(picker.open()).toBe(false);
    picker.pick('2026-11-17');
    expect(emitted).toEqual(['2026-11-16', null]);
  });

  it('does not show with a single day', () => {
    const { root } = render(['2026-11-17'], null);
    expect(root.querySelector('nav')).toBeNull();
  });
});
