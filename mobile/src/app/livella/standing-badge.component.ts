import { Component, computed, input } from '@angular/core';
import { STANDING_LABELS, Standing } from './livella';

/** Stato rispetto al tuo solito: icona e parole, mai solo colore (WCAG 1.4.1). `null` = calibrazione. */
@Component({
  selector: 'app-standing-badge',
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      line-height: 16px;
      color: var(--rl-text-2);
    }
    :host([data-standing='meglio']) {
      color: var(--rl-ok-text);
    }
    :host([data-standing='peggio']) {
      color: var(--rl-warn);
    }
    svg {
      width: 12px;
      height: 12px;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
  host: { '[attr.data-standing]': 'standing() ?? "calibrazione"' },
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (standing()) {
        @case ('meglio') {
          <path d="M5 12l4 4 10-10"></path>
        }
        @case ('peggio') {
          <path d="M12 4l9 16H3z"></path>
          <path d="M12 10v4"></path>
        }
        @case ('solito') {
          <circle cx="12" cy="12" r="8"></circle>
          <circle cx="12" cy="12" r="2" fill="currentColor"></circle>
        }
        @default {
          <circle cx="12" cy="12" r="8" stroke-dasharray="3 4"></circle>
        }
      }
    </svg>
    <span>{{ label() }}</span>
  `,
})
export class StandingBadgeComponent {
  readonly standing = input.required<Standing | null>();
  /** Parole al posto di quelle standard, per esempio «Calibrazione, notte 3 di 7». */
  readonly text = input<string | null>(null);

  protected readonly label = computed(() => {
    const standing = this.standing();
    return this.text() ?? (standing === null ? 'In calibrazione' : STANDING_LABELS[standing]);
  });
}
