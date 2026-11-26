import { Component, computed, input } from '@angular/core';
import { Direction } from '../livella/livella';
import { LivellaComponent, UsualLabels } from '../livella/livella.component';

/** Una misura confrontata con la tua media: nome, parole sullo stato, livella, valore. */
export interface MeasureRowData {
  id: string;
  label: string;
  /** Che cosa è, o come sta rispetto al solito quando è fuori dalla fascia («Meno del solito»). */
  sub: string;
  /** Colore delle parole: solo quando è fuori dalla fascia. `peggio` è sempre detto anche a parole. */
  tone: 'peggio' | 'meglio' | null;
  /** Scostamento dalla tua media, da −3 a 3. `null` finché non ci sono 7 giorni. */
  deviation: number | null;
  direction: Direction;
  value: string;
  unit: string;
}

/**
 * Riga di una misura (ADR 0020). `inline`: nome a sinistra, livella al centro, valore a destra (Sonno).
 * `stacked`: nome e valore sopra, parole e livella sotto (contributori del Recupero).
 */
@Component({
  selector: 'app-measure-row',
  imports: [LivellaComponent],
  styleUrl: './measure-row.component.scss',
  host: { '[attr.data-layout]': 'layout()' },
  template: `
    <span class="names">
      <span class="name">{{ row().label }}</span>
      <span class="sub" [attr.data-tone]="row().tone">{{ row().sub }}</span>
    </span>
    <app-livella
      class="gauge"
      [deviation]="row().deviation"
      [direction]="row().direction"
      [labels]="labels()"
      [description]="description()"
    ></app-livella>
    <span class="reading">
      <span class="value">{{ row().value }}</span>
      <span class="unit">{{ row().unit }}</span>
    </span>
  `,
})
export class MeasureRowComponent {
  readonly row = input.required<MeasureRowData>();
  readonly layout = input<'inline' | 'stacked'>('inline');
  readonly labels = input<UsualLabels | null>(null);

  protected readonly description = computed(() => `${this.row().value} ${this.row().unit}`);
}
