import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RevealDirective } from './reveal.directive';

@Component({ imports: [RevealDirective], template: `<p appReveal>testo</p>` })
class HostComponent {}

type Callback = (entries: { isIntersecting: boolean }[]) => void;

describe('RevealDirective', () => {
  const original = globalThis.IntersectionObserver;
  let callback: Callback | null = null;
  let disconnected = 0;

  function fakeObserver(): void {
    callback = null;
    disconnected = 0;
    globalThis.IntersectionObserver = class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe(): void {}
      disconnect(): void {
        disconnected++;
      }
    } as unknown as typeof IntersectionObserver;
  }

  beforeEach(() => RevealDirective.resetForTests());

  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('p')!;
  }

  it('hides the block until it scrolls into view, then shows it once', () => {
    fakeObserver();
    const p = render();
    expect(p.classList.contains('reveal')).toBe(true);
    expect(p.classList.contains('revealed')).toBe(false);

    callback!([{ isIntersecting: false }]);
    expect(p.classList.contains('revealed')).toBe(false);

    callback!([{ isIntersecting: true }]);
    expect(p.classList.contains('revealed')).toBe(true);
    expect(disconnected).toBe(1);
  });

  it('does not fade again a block already shown in this session when it is created anew', () => {
    fakeObserver();
    callback = null;
    render();
    callback!([{ isIntersecting: true }]);
    const again = render();
    expect(again.classList.contains('reveal')).toBe(false);
  });

  it('leaves the block visible where the browser cannot observe it', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const p = render();
    expect(p.classList.contains('reveal')).toBe(false);
  });
});
