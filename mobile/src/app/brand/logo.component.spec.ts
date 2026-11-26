import { TestBed } from '@angular/core/testing';
import { LogoComponent } from './logo.component';

describe('LogoComponent', () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(LogoComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('is a named image on its own', () => {
    const svg = render().querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('RingLife');
  });

  it('writes the name and hides the symbol from screen readers when it has a wordmark', () => {
    const root = render({ wordmark: true });
    expect(root.querySelector('.name')?.textContent).toBe('RingLife');
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('svg')?.getAttribute('role')).toBeNull();
  });

  it('uses the requested size and moves only when animated', () => {
    const still = render({ size: 40 });
    expect(still.querySelector('svg')?.getAttribute('width')).toBe('40');
    expect(still.querySelector('svg')?.classList.contains('animated')).toBe(false);
    const moving = render({ animated: true });
    expect(moving.querySelector('svg')?.classList.contains('animated')).toBe(true);
  });
});
