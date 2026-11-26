import { Component, computed, input } from '@angular/core';
import { formatThousands } from '../shared/format';
import { MovementRowData } from './oggi.model';

const BAR_WIDTH = 120;

/** Riga del Movimento. Al mattino è «in corso»: passi e barra verso l'obiettivo, nessun confronto con la tua media. */
@Component({
  selector: 'app-movement-row',
  styleUrl: './row.scss',
  host: { 'data-domain': 'movimento' },
  template: `
    <span class="names">
      <h3 class="name">Movimento</h3>
      <span class="hint">In corso, su {{ goal() }}</span>
    </span>
    <svg
      [attr.width]="width"
      height="16"
      [attr.viewBox]="'0 0 ' + width + ' 16'"
      role="progressbar"
      aria-label="Passi verso l'obiettivo"
      aria-valuemin="0"
      [attr.aria-valuemax]="row().goal"
      [attr.aria-valuenow]="row().steps"
    >
      <rect class="track" x="0" y="3" [attr.width]="width" height="10" rx="5"></rect>
      <rect class="fill" x="0" y="3" [attr.width]="fillWidth()" height="10" rx="5"></rect>
      <rect class="goal" [attr.x]="width - 2" y="0" width="2" height="16" rx="1"></rect>
    </svg>
    <span class="reading">
      <span class="number">{{ steps() }}</span>
      <span class="unit">passi</span>
    </span>
  `,
})
export class MovementRowComponent {
  readonly row = input.required<MovementRowData>();
  protected readonly width = BAR_WIDTH;

  protected readonly steps = computed(() => formatThousands(this.row().steps));
  protected readonly goal = computed(() => formatThousands(this.row().goal));
  protected readonly fillWidth = computed(() => {
    const { steps, goal } = this.row();
    // Almeno un tondo pieno, altrimenti i primi passi non si vedono.
    return goal > 0 && steps > 0 ? Math.max(10, Math.min(1, steps / goal) * BAR_WIDTH) : 0;
  });
}
