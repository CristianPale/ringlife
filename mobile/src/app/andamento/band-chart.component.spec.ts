import { TestBed } from '@angular/core/testing';
import { BandChartComponent } from './band-chart.component';

describe('BandChartComponent', () => {
  function render(openable: (day: string) => boolean = () => false) {
    const fixture = TestBed.createComponent(BandChartComponent);
    fixture.componentRef.setInput('values', [400, 420, 300]);
    fixture.componentRef.setInput('band', { median: 410, low: 380, high: 440 });
    fixture.componentRef.setInput('label', 'Durata del sonno');
    fixture.componentRef.setInput('dates', ['2026-11-01', '2026-11-02', '2026-11-03']);
    fixture.componentRef.setInput('format', (v: number) => `${v} min`);
    fixture.componentRef.setInput('openable', openable);
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((day) => opened.push(day));
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, opened };
  }

  it('reads nothing until a point is chosen, then says the day, the value and where it sits', () => {
    const { fixture, root } = render();
    expect(root.querySelector('.readout')).toBeNull();
    expect(root.querySelector('svg')?.getAttribute('tabindex')).toBe('0');
    fixture.componentInstance.select(2);
    fixture.detectChanges();
    expect(root.querySelector('.readout p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Martedì 3 novembre: 300 min · sotto la tua fascia');
    expect(root.querySelector('.dot-picked')).not.toBeNull();
    // Senza dettaglio da aprire non c'è il pulsante.
    expect(root.querySelector('.open')).toBeNull();
  });

  it('opens the chosen day when its detail can show it', () => {
    const { fixture, root, opened } = render((day) => day === '2026-11-02');
    fixture.componentInstance.select(1);
    fixture.detectChanges();
    expect(root.querySelector('.readout p')?.textContent).toContain('nella tua fascia');
    root.querySelector<HTMLButtonElement>('.open')!.click();
    expect(opened).toEqual(['2026-11-02']);
  });

  it('moves between days with the arrow keys', () => {
    const { fixture, root } = render();
    root.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(root.querySelector('.readout p')?.textContent).toContain('2 novembre');
  });

  it('picks the nearest point to a horizontal position', () => {
    const { fixture } = render();
    expect(fixture.componentInstance.nearest(0)).toBe(0);
    expect(fixture.componentInstance.nearest(1000)).toBe(2);
  });
});
