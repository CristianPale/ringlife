import { TestBed } from '@angular/core/testing';
import { MeasureRowComponent, MeasureRowData } from './measure-row.component';

const ROW: MeasureRowData = {
  id: 'hrv',
  label: 'Variabilità del battito (HRV)',
  sub: 'Più bassa del solito',
  tone: 'peggio',
  deviation: -1.8,
  direction: 'up',
  value: '38',
  unit: 'millisecondi',
};

function render(row: MeasureRowData, layout: 'inline' | 'stacked' = 'inline', labels: { low: string; high: string } | null = null) {
  const fixture = TestBed.createComponent(MeasureRowComponent);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('layout', layout);
  fixture.componentRef.setInput('labels', labels);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MeasureRowComponent', () => {
  it('shows name, words on the standing, livella and value with its unit', () => {
    const root = render(ROW);
    expect(root.querySelector('.name')?.textContent).toBe('Variabilità del battito (HRV)');
    expect(root.querySelector('.sub')?.textContent).toBe('Più bassa del solito');
    expect(root.querySelector('.sub')?.getAttribute('data-tone')).toBe('peggio');
    expect(root.querySelector('app-livella .bubble.peggio')).not.toBeNull();
    expect(root.querySelector('.value')?.textContent).toBe('38');
    expect(root.querySelector('.unit')?.textContent).toBe('millisecondi');
  });

  it('reads value and unit to VoiceOver with the standing', () => {
    expect(render(ROW).querySelector('app-livella svg')?.getAttribute('aria-label')).toBe('Peggio del solito, 38 millisecondi');
  });

  it('has no tone when it is within the usual', () => {
    const root = render({ ...ROW, sub: 'Il più basso della notte', tone: null, deviation: 0.3 });
    expect(root.querySelector('.sub')?.getAttribute('data-tone')).toBeNull();
    expect(root.querySelector('.bubble.peggio')).toBeNull();
  });

  it('shows an empty tube while calibrating', () => {
    expect(render({ ...ROW, deviation: null }).querySelector('app-livella .empty')).not.toBeNull();
  });

  it('can stack the livella under the name and write the usual range under the marks', () => {
    const root = render(ROW, 'stacked', { low: '66', high: '82' });
    expect((root as HTMLElement).getAttribute('data-layout')).toBe('stacked');
    expect(Array.from(root.querySelectorAll('app-livella text')).map((t) => t.textContent)).toEqual(['66', 'il tuo solito', '82']);
  });
});
