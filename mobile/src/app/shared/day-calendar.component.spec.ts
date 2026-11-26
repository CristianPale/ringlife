import { TestBed } from '@angular/core/testing';
import { DayCalendarComponent } from './day-calendar.component';

describe('DayCalendarComponent', () => {
  function render(days: string[], selected: string) {
    const fixture = TestBed.createComponent(DayCalendarComponent);
    fixture.componentRef.setInput('days', days);
    fixture.componentRef.setInput('selected', selected);
    fixture.componentRef.setInput('today', '2026-11-19');
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((day) => picked.push(day));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const day = (n: number) =>
      [...root.querySelectorAll<HTMLButtonElement>('.day')].find((b) => b.textContent?.trim() === String(n))!;
    const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { fixture, root, picked, day, button };
  }

  const DAYS = ['2026-10-30', '2026-10-31', '2026-11-16', '2026-11-17', '2026-11-18'];

  it('opens on the month of the day shown, with only the days with data to touch', () => {
    const { root, day } = render(DAYS, '2026-11-17');
    expect(root.querySelector('.title')?.textContent?.trim()).toBe('Novembre 2026');
    expect(day(17).classList).toContain('chosen');
    expect(day(17).getAttribute('aria-pressed')).toBe('true');
    expect(day(16).disabled).toBe(false);
    expect(day(15).disabled).toBe(true);
    expect(day(15).getAttribute('aria-label')).toBe('domenica 15 novembre, nessun dato');
    expect(day(19).classList).toContain('today');
  });

  it('gives back the day touched', () => {
    const { picked, day } = render(DAYS, '2026-11-17');
    day(16).click();
    expect(picked).toEqual(['2026-11-16']);
  });

  it('pages between the months of the first and the last day, and no further', () => {
    const { fixture, root, button, day } = render(DAYS, '2026-11-17');
    expect(button('Mese successivo').disabled).toBe(true);
    button('Mese precedente').click();
    fixture.detectChanges();
    expect(root.querySelector('.title')?.textContent?.trim()).toBe('Ottobre 2026');
    expect(day(31).disabled).toBe(false);
    expect(button('Mese precedente').disabled).toBe(true);
  });
});
