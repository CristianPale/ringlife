import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

/**
 * Fa comparire un blocco in dissolvenza quando entra nello schermo scorrendo (ADR 0020, animazioni di Oggi).
 * Lo stile sta in `styles.scss` (`.reveal`, `.revealed`) e vale solo senza «riduci movimento». Dove il browser non
 * ha `IntersectionObserver` il blocco resta semplicemente visibile.
 *
 * Una volta per sessione dell'app: un blocco già comparso, se Angular lo ricrea (dati nuovi, ritorno sulla pagina),
 * compare subito senza ripetere la dissolvenza. Il blocco si riconosce dalla chiave (`appReveal="riepilogo"`) o, senza,
 * dal tag e dalle classi.
 */
@Directive({ selector: '[appReveal]' })
export class RevealDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer: IntersectionObserver | null = null;
  readonly key = input('', { alias: 'appReveal' });

  /** I blocchi già comparsi in questa sessione dell'app. */
  private static readonly shown = new Set<string>();
  /** Solo per i test. */
  static resetForTests(): void {
    RevealDirective.shown.clear();
  }

  ngOnInit(): void {
    const id = this.key() || `${this.element.tagName}.${this.element.className}`;
    if (typeof IntersectionObserver === 'undefined' || RevealDirective.shown.has(id)) {
      return;
    }
    this.element.classList.add('reveal');
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.element.classList.add('revealed');
          RevealDirective.shown.add(id);
          // Una volta sola: tornando su non sparisce di nuovo.
          this.observer?.disconnect();
          this.observer = null;
        }
      },
      { threshold: 0.15 },
    );
    this.observer.observe(this.element);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
