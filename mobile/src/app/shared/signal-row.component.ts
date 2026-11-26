import { Component, input } from '@angular/core';
import { ZoneBadgeComponent } from '../oggi/zone-badge.component';
import { Zone } from '../oggi/zone';

/** Un segnale che pesa su un indice: nome, valore, spiegazione, barra 0-100 e zona. */
export interface SignalRow {
  id: string;
  label: string;
  /** Nome esteso se `label` è una sigla. Va sempre mostrato accanto. */
  fullName?: string;
  /** Che cosa misura, in parole semplici. */
  help: string;
  /** Peso nel punteggio, da 0 a 1. */
  weight: number;
  /** Sotto-punteggio 0-100: 75 è «nella tua media». */
  score: number;
  zone: Zone;
  valueText: string;
  baselineText?: string;
}

/** Riga di un contributore: stessa forma per Recupero e Sonno. Il colore segue il dominio. */
@Component({
  selector: 'app-signal-row',
  imports: [ZoneBadgeComponent],
  styleUrl: './signal-row.component.scss',
  host: { class: 'signal', '[attr.data-domain]': 'domain()' },
  template: `
    <div class="signal-head">
      <span class="signal-name">
        {{ signal().label }}
        @if (signal().fullName) {
          <span class="full-name">{{ signal().fullName }}</span>
        }
      </span>
      <span class="signal-weight">pesa il {{ percent() }}%</span>
    </div>
    <div class="signal-value">
      <span class="signal-number">{{ signal().valueText }}</span>
      @if (signal().baselineText) {
        <span class="signal-baseline">{{ signal().baselineText }}</span>
      }
    </div>
    <p class="signal-help">{{ signal().help }}</p>
    <div class="signal-foot">
      <div
        class="bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="signal().score"
        [attr.aria-label]="signal().label + ': ' + signal().score + ' su 100'"
      >
        <span class="bar-fill" [style.width.%]="signal().score"></span>
        @if (showAverage()) {
          <span class="bar-typical" aria-hidden="true"></span>
        }
      </div>
      <app-zone-badge [zone]="signal().zone"></app-zone-badge>
    </div>
  `,
})
export class SignalRowComponent {
  readonly signal = input.required<SignalRow>();
  /** Segno sulla «tua media» (75). Si toglie dove il punteggio si misura contro un obiettivo e non contro la media. */
  readonly showAverage = input(true);
  readonly domain = input<'recupero' | 'sonno' | 'movimento' | 'stress'>('recupero');

  protected percent(): number {
    return Math.round(this.signal().weight * 100);
  }
}
