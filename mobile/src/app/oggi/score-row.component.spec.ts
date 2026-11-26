import { TestBed } from '@angular/core/testing';
import { MovementRowComponent } from './movement-row.component';
import { ScoreRowData } from './oggi.model';
import { CALIBRATION_DAYS, ScoreRowComponent, calibrationText } from './score-row.component';

const ROW: ScoreRowData = { domain: 'sonno', label: 'Sonno', value: 62, deviation: -2.65, calibrationDays: 28 };

function renderScore(row: ScoreRowData) {
  const fixture = TestBed.createComponent(ScoreRowComponent);
  fixture.componentRef.setInput('row', row);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ScoreRowComponent', () => {
  it('shows name, standing in words, livella and number', () => {
    const root = renderScore(ROW);
    expect(root.querySelector('.name')?.textContent).toBe('Sonno');
    expect(root.querySelector('app-standing-badge')?.textContent).toContain('Peggio del solito');
    expect(root.querySelector('app-livella .bubble')).not.toBeNull();
    expect(root.querySelector('.number')?.textContent).toBe('62');
  });

  it('says how far the calibration is while there is no average', () => {
    const root = renderScore({ ...ROW, deviation: null, calibrationDays: 3 });
    expect(root.querySelector('app-standing-badge')?.textContent).toContain('Calibrazione, 3 giorni su 7');
    expect(root.querySelector('app-livella .bubble')).toBeNull();
    expect(root.querySelector('app-livella svg')?.getAttribute('aria-label')).toContain('Calibrazione, 3 giorni su 7');
  });
});

describe('calibrationText', () => {
  it('counts the days against seven', () => {
    expect(calibrationText(0)).toBe('Calibrazione, 0 giorni su 7');
    expect(calibrationText(1)).toBe('Calibrazione, 1 giorno su 7');
    expect(calibrationText(6)).toBe('Calibrazione, 6 giorni su 7');
  });

  it('does not pretend to calibrate when the days are enough but the server sent no comparison', () => {
    expect(calibrationText(CALIBRATION_DAYS)).toBe('Senza confronto con la tua media');
  });
});

describe('MovementRowComponent', () => {
  function renderMovement(steps: number, goal: number) {
    const fixture = TestBed.createComponent(MovementRowComponent);
    fixture.componentRef.setInput('row', { steps, goal });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('fills the bar in proportion to the goal, like the 16% of the design', () => {
    const root = renderMovement(1240, 8000);
    expect(Number(root.querySelector('.fill')?.getAttribute('width'))).toBeCloseTo(18.6, 1);
  });

  it('keeps a visible dot for the first steps and never goes past the goal', () => {
    expect(Number(renderMovement(30, 8000).querySelector('.fill')?.getAttribute('width'))).toBe(10);
    expect(Number(renderMovement(20000, 8000).querySelector('.fill')?.getAttribute('width'))).toBe(120);
    expect(Number(renderMovement(0, 8000).querySelector('.fill')?.getAttribute('width'))).toBe(0);
    expect(Number(renderMovement(500, 0).querySelector('.fill')?.getAttribute('width'))).toBe(0);
  });
});
