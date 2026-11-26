import { TestBed } from '@angular/core/testing';
import { Direction } from './livella';
import { LivellaComponent } from './livella.component';

function render(inputs: { deviation: number | null; direction?: Direction; labels?: { low: string; high: string } | null; description?: string | null }) {
  const fixture = TestBed.createComponent(LivellaComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('LivellaComponent', () => {
  it('draws the tube, the usual band, two marks and the bubble', () => {
    const root = render({ deviation: -1.9 });
    expect(root.querySelector('.tube')).not.toBeNull();
    expect(root.querySelector('.usual')?.getAttribute('width')).toBe('60');
    expect(root.querySelectorAll('.mark')).toHaveLength(2);
    expect(root.querySelector('.bubble')?.getAttribute('cx')).toBe('22');
  });

  it('colours the bubble amber only when it is worse than usual', () => {
    expect(render({ deviation: -2 }).querySelector('.bubble')?.classList.contains('peggio')).toBe(true);
    expect(render({ deviation: 0 }).querySelector('.bubble')?.classList.contains('peggio')).toBe(false);
    expect(render({ deviation: 2.5 }).querySelector('.bubble')?.classList.contains('peggio')).toBe(false);
  });

  it('follows the direction of the measure: a low resting heart rate is not worse', () => {
    expect(render({ deviation: -2, direction: 'down' }).querySelector('.bubble')?.classList.contains('peggio')).toBe(false);
    expect(render({ deviation: 2, direction: 'down' }).querySelector('.bubble')?.classList.contains('peggio')).toBe(true);
  });

  it('says the standing to VoiceOver, with the reading when given', () => {
    expect(render({ deviation: -2 }).querySelector('svg')?.getAttribute('aria-label')).toBe('Peggio del solito');
    expect(render({ deviation: 0, description: '38 millisecondi' }).querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Come al solito, 38 millisecondi',
    );
  });

  it('is an empty dashed tube without a bubble while calibrating', () => {
    const root = render({ deviation: null });
    expect(root.querySelector('.empty')).not.toBeNull();
    expect(root.querySelector('.bubble')).toBeNull();
    expect(root.querySelector('.mark')).toBeNull();
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('In calibrazione');
  });

  it('writes the ends of the usual band under the marks when given', () => {
    const root = render({ deviation: 0.2, labels: { low: '66', high: '82' } });
    const texts = Array.from(root.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toEqual(['66', 'il tuo solito', '82']);
    expect(root.querySelector('svg')?.getAttribute('height')).toBe('34');
  });
});
