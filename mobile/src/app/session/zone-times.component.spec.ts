import { TestBed } from '@angular/core/testing';
import { ZoneTimesComponent } from './zone-times.component';

describe('ZoneTimesComponent', () => {
  it('lists the five zones from the hardest, with their range and time', () => {
    const fixture = TestBed.createComponent(ZoneTimesComponent);
    fixture.componentRef.setInput('maxHr', 200);
    fixture.componentRef.setInput('samples', [
      { t: 0, bpm: 150 },
      { t: 61_000, bpm: 150 },
    ]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('li'));
    expect(rows.map((li) => li.querySelector('.name')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Zona 5 · massima da 180',
      'Zona 4 · intensa 160-179',
      'Zona 3 · moderata 140-159',
      'Zona 2 · leggera 120-139',
      'Zona 1 · molto leggera 100-119',
    ]);
    // 5 secondi dal primo battito (il buco si ferma lì) più 1 s dell'ultimo.
    expect(rows[2].querySelector('.time')?.textContent).toBe('0:06');
    expect(root.textContent).toContain('Battito massimo stimato dall\'età: 200');
  });
});
