import { TestBed } from '@angular/core/testing';
import { DayHrChartComponent } from './day-hr-chart.component';

describe('DayHrChartComponent', () => {
  function render(points: { min: number; bpm: number }[], resting: number | null = null) {
    const fixture = TestBed.createComponent(DayHrChartComponent);
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('resting', resting);
    fixture.componentRef.setInput('nowMin', 15 * 60);
    fixture.detectChanges();
    return fixture;
  }

  it('draws one line per stretch of readings and a dot for a lone one', () => {
    const fixture = render([0, 5, 10, 300, 305, 600].map((m) => ({ min: m, bpm: 60 + (m % 7) })));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('polyline.line')).toHaveLength(2);
    expect(root.querySelectorAll('circle.single')).toHaveLength(1);
    expect(root.querySelector('line.now')).not.toBeNull();
  });

  it('draws your resting heart rate as a dashed line and says it in words', () => {
    const fixture = render([{ min: 60, bpm: 70 }, { min: 65, bpm: 80 }], 54);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('line.resting')).not.toBeNull();
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Battito di oggi dalle 01:00 alle 01:05: da 70 a 80 battiti al minuto. Il tuo battito a riposo di notte è 54.',
    );
  });

  it('shows time and heart rate of the reading picked by touch or keyboard', () => {
    const fixture = render([{ min: 60, bpm: 70 }, { min: 600, bpm: 81 }]);
    const chart = fixture.componentInstance;
    chart.select(1);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('text.label')?.textContent).toBe('10:00 · 81 battiti al minuto');
    root.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(root.querySelector('text.label')?.textContent).toBe('01:00 · 70 battiti al minuto');
  });
});
