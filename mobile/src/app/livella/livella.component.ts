import { Component, computed, input } from '@angular/core';
import { Direction, STANDING_LABELS, livellaLayout, standingOf } from './livella';

/** Estremi della fascia «il tuo solito», già scritti nella unità della metrica (66, 82). */
export interface UsualLabels {
  low: string;
  high: string;
}

/**
 * La livella (ADR 0020): tubo, due tacche («il tuo solito») e una bolla. Verde nel solito o meglio, ambra se peggio.
 * Senza scostamento (calibrazione) il tubo è vuoto e tratteggiato. Lo stato è sempre detto anche a parole accanto.
 */
@Component({
  selector: 'app-livella',
  styles: `
    :host {
      display: block;
      line-height: 0;
    }
    svg {
      max-width: 100%;
      height: auto;
      overflow: visible;
    }
    .tube {
      fill: var(--rl-tube);
    }
    .usual {
      fill: var(--rl-usual);
    }
    .mark {
      fill: var(--rl-mark);
    }
    .empty {
      fill: none;
      stroke: var(--rl-usual);
      stroke-width: 1.5;
      stroke-dasharray: 3 4;
    }
    .bubble {
      fill: var(--rl-ok);
      stroke: var(--livella-ring, var(--rl-bg));
      stroke-width: 2;
    }
    .bubble.peggio {
      fill: var(--rl-warn);
    }
    text {
      fill: var(--rl-muted);
      font-size: 12px;
      font-family: var(--rl-font-text);
    }
    text.number {
      font-family: var(--rl-font-mono);
    }
  `,
  template: `
    <svg [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="'0 0 ' + width() + ' ' + height()" role="img" [attr.aria-label]="ariaLabel()">
      @if (layout().bubbleX === null) {
        <rect class="empty" x="0.75" y="3.75" [attr.width]="width() - 1.5" height="8.5" rx="4.25"></rect>
      } @else {
        <rect class="tube" x="0" y="3" [attr.width]="width()" height="10" rx="5"></rect>
        <rect class="usual" [attr.x]="layout().usualX" y="3" [attr.width]="layout().usualWidth" height="10"></rect>
        <rect class="mark" [attr.x]="layout().markLeft - 1" y="0" width="2" height="16" rx="1"></rect>
        <rect class="mark" [attr.x]="layout().markRight - 1" y="0" width="2" height="16" rx="1"></rect>
        <circle class="bubble" [class.peggio]="standing() === 'peggio'" [attr.cx]="layout().bubbleX" cy="8" [attr.r]="radius()"></circle>
      }
      @if (labels(); as l) {
        <text class="number" [attr.x]="layout().markLeft" y="31" text-anchor="middle">{{ l.low }}</text>
        <text [attr.x]="width() / 2" y="31" text-anchor="middle">il tuo solito</text>
        <text class="number" [attr.x]="layout().markRight" y="31" text-anchor="middle">{{ l.high }}</text>
      }
    </svg>
  `,
})
export class LivellaComponent {
  /** Scostamento dalla tua media, da −3 a 3. `null` in calibrazione. */
  readonly deviation = input.required<number | null>();
  readonly direction = input<Direction>('up');
  readonly width = input(120);
  readonly labels = input<UsualLabels | null>(null);
  /** Frase letta da VoiceOver al posto dello stato standard (per esempio «Come al solito, 38 millisecondi»). */
  readonly description = input<string | null>(null);

  protected readonly height = computed(() => (this.labels() ? 34 : 16));
  protected readonly radius = computed(() => (this.labels() ? 6 : 5));
  protected readonly layout = computed(() => livellaLayout(this.width(), this.deviation(), this.radius()));
  protected readonly standing = computed(() => {
    const deviation = this.deviation();
    return deviation === null ? null : standingOf(deviation, this.direction());
  });
  protected readonly ariaLabel = computed(() => {
    const standing = this.standing();
    const base = standing === null ? 'In calibrazione' : STANDING_LABELS[standing];
    const extra = this.description();
    return extra ? `${base}, ${extra}` : base;
  });
}
