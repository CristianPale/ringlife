import { TestBed } from '@angular/core/testing';
import { DebtBarsComponent } from './debt-bars.component';

function render(nights: { label: string; minutes: number | null }[], goalMin = 480) {
  const fixture = TestBed.createComponent(DebtBarsComponent);
  fixture.componentRef.setInput('nights', nights);
  fixture.componentRef.setInput('goalMin', goalMin);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const WEEK = [
  { label: 'mer', minutes: 444 },
  { label: 'gio', minutes: 474 },
  { label: 'ven', minutes: 408 },
  { label: 'sab', minutes: 450 },
  { label: 'dom', minutes: 486 },
  { label: 'lun', minutes: 420 },
  { label: 'mar', minutes: 352 },
];

describe('DebtBarsComponent', () => {
  it('draws one bar per night with its weekday, tonight highlighted', () => {
    const root = render(WEEK);
    expect(root.querySelectorAll('.bar')).toHaveLength(7);
    expect(root.querySelectorAll('.bar.tonight')).toHaveLength(1);
    expect(Array.from(root.querySelectorAll('text:not(.number)')).map((t) => t.textContent)).toEqual(['mer', 'gio', 'ven', 'sab', 'dom', 'lun', 'mar']);
  });

  it('draws the goal line and names it', () => {
    const root = render(WEEK);
    expect(root.querySelector('.goal')).not.toBeNull();
    expect(root.querySelector('text.number')?.textContent).toBe('8 h');
  });

  it('keeps a night longer than the goal inside the picture', () => {
    const root = render(WEEK);
    const tallest = Math.min(...Array.from(root.querySelectorAll('.bar')).map((b) => Number(b.getAttribute('y'))));
    expect(tallest).toBeGreaterThanOrEqual(10);
  });

  it('draws no bar for a night without data', () => {
    const root = render([...WEEK.slice(0, 6), { label: 'mar', minutes: null }]);
    expect(root.querySelectorAll('.bar')).toHaveLength(6);
  });

  it('describes the week in words', () => {
    expect(render(WEEK).querySelector('svg')?.getAttribute('aria-label')).toBe(
      "Ore di sonno delle ultime 7 notti rispetto all'obiettivo di 8 h 00. Stanotte 5 h 52.",
    );
  });
});
