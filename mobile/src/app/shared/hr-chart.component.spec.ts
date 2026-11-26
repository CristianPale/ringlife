import { TestBed } from '@angular/core/testing';
import { HrChartComponent, HrPoint } from './hr-chart.component';

describe('HrChartComponent', () => {
  const points: HrPoint[] = [
    { t: 0, bpm: 72 },
    { t: 60_000, bpm: 68 },
    { t: 120_000, bpm: 64 },
    { t: 180_000, bpm: 66 },
  ];

  function render(interactive: boolean, live = false) {
    const fixture = TestBed.createComponent(HrChartComponent);
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('interactive', interactive);
    fixture.componentRef.setInput('live', live);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, chart: fixture.componentInstance };
  }

  it('draws both axes with minutes and beats per minute', () => {
    const { root } = render(false);
    const labels = Array.from(root.querySelectorAll('text.tick')).map((t) => t.textContent?.trim());
    expect(labels).toContain('min');
    expect(labels).toContain('bpm');
    expect(labels).toEqual(expect.arrayContaining(['0', '1', '2', '3']));
    expect(labels).toEqual(expect.arrayContaining(['60', '70', '80']));
    expect(root.querySelector('polyline')).not.toBeNull();
  });

  it('describes the session in words', () => {
    const { root } = render(false);
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Battito in 3:00: da 64 a 72 battiti al minuto.');
  });

  it('shows minute and beat of the selected point, only when interactive', () => {
    const { fixture, root, chart } = render(true);
    chart.select(2);
    fixture.detectChanges();
    expect(root.querySelector('text.label')?.textContent).toBe('2:00 · 64 bpm');

    const passive = render(false);
    passive.chart.select(2);
    passive.fixture.detectChanges();
    expect(passive.root.querySelector('text.label')).toBeNull();
  });

  it('finds the point nearest to a horizontal position', () => {
    const { chart } = render(true);
    // L'area del grafico va da 34 a 330: il punto a 2 minuti (su 3) sta circa a 231.
    expect(chart.nearest(231)).toBe(2);
    expect(chart.nearest(0)).toBe(0);
  });

  it('marks the latest value while live', () => {
    const { root } = render(false, true);
    expect(root.querySelector('circle.dot')).not.toBeNull();
  });
});
