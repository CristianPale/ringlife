import { TestBed } from '@angular/core/testing';
import { Standing } from './livella';
import { StandingBadgeComponent } from './standing-badge.component';

function render(standing: Standing | null, text: string | null = null) {
  const fixture = TestBed.createComponent(StandingBadgeComponent);
  fixture.componentRef.setInput('standing', standing);
  fixture.componentRef.setInput('text', text);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('StandingBadgeComponent', () => {
  it('names each standing in words, with an icon', () => {
    expect(render('meglio').textContent).toContain('Meglio del solito');
    expect(render('solito').textContent).toContain('Come al solito');
    expect(render('peggio').textContent).toContain('Peggio del solito');
    expect(render('peggio').querySelector('svg')).not.toBeNull();
  });

  it('says it is calibrating when there is no standing, or the given words', () => {
    expect(render(null).textContent).toContain('In calibrazione');
    expect(render(null, 'Calibrazione, 3 giorni su 7').textContent).toContain('Calibrazione, 3 giorni su 7');
  });

  it('marks the standing on the host for the colour', () => {
    expect(render('peggio').getAttribute('data-standing')).toBe('peggio');
    expect(render(null).getAttribute('data-standing')).toBe('calibrazione');
  });
});
