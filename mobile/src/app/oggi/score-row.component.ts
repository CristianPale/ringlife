import { Component, computed, input } from '@angular/core';
import { LivellaComponent } from '../livella/livella.component';
import { Standing, standingOf } from '../livella/livella';
import { StandingBadgeComponent } from '../livella/standing-badge.component';
import { ScoreRowData } from './oggi.model';

/** Giorni di storia che servono per la tua media (docs/scores.md). */
export const CALIBRATION_DAYS = 7;

/** «Calibrazione, 3 giorni su 7». Oltre i 7 giorni senza confronto vuol dire che il server non lo manda. */
export function calibrationText(days: number): string {
  if (days >= CALIBRATION_DAYS) {
    return 'Senza confronto con la tua media';
  }
  return `Calibrazione, ${days} ${days === 1 ? 'giorno' : 'giorni'} su ${CALIBRATION_DAYS}`;
}

/** Riga di un indice 0-100: nome, stato rispetto alla tua media, livella e numero. */
@Component({
  selector: 'app-score-row',
  imports: [LivellaComponent, StandingBadgeComponent],
  styleUrl: './row.scss',
  host: { '[attr.data-domain]': 'row().domain' },
  template: `
    <span class="names">
      <h3 class="name">{{ row().label }}</h3>
      <app-standing-badge [standing]="standing()" [text]="calibration()"></app-standing-badge>
    </span>
    <app-livella [deviation]="row().deviation" [description]="calibration()"></app-livella>
    <span class="reading score">
      <span class="number">{{ row().value }}</span>
      <span class="unit">su 100</span>
    </span>
  `,
})
export class ScoreRowComponent {
  readonly row = input.required<ScoreRowData>();

  protected readonly standing = computed<Standing | null>(() => {
    const deviation = this.row().deviation;
    return deviation === null ? null : standingOf(deviation);
  });
  protected readonly calibration = computed(() => (this.row().deviation === null ? calibrationText(this.row().calibrationDays) : null));
}
