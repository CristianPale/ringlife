import { Component, input } from '@angular/core';
import { timeText } from '../temperatura/temperatura.model';
import { DayHrChartComponent } from './day-hr-chart.component';
import { HeartToday } from './heart-today';
import { InfoLinkComponent } from '../guida/info-link.component';

/**
 * «Battito di oggi» in Oggi (docs/adr/0035): l'ultima misura dell'anello con l'ora, il grafico del giorno e una riga
 * con la misura più bassa, la più alta e ogni quanto l'anello misura.
 */
@Component({
  selector: 'app-heart-today',
  imports: [InfoLinkComponent, DayHrChartComponent],
  styles: `
    :host {
      display: block;
      margin-top: 28px;
      margin-bottom: 20px;
    }
    h2 {
      margin: 0 0 12px;
      font-family: var(--rl-font-voice);
      font-size: 22px;
      line-height: 28px;
      font-weight: 500;
    }
    .heart-now {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 8px;
    }
    .heart-value {
      font-family: var(--rl-font-mono);
      font-size: 30px;
      line-height: 36px;
      font-weight: 500;
      letter-spacing: -0.03em;
    }
    .heart-unit,
    .heart-note {
      color: var(--rl-text-2);
    }
    .heart-unit {
      font-size: 14px;
      line-height: 18px;
    }
    app-day-hr-chart {
      max-width: 340px;
    }
    .heart-note {
      margin: 8px 0 0;
      font-size: 13px;
      line-height: 18px;
    }
  `,
  template: `
    <section class="heart" aria-labelledby="battito">
      <h2 id="battito">Battito di oggi <app-info topic="battito-oggi"></app-info></h2>
      @if (heart(); as h) {
        <p class="heart-now">
          <span class="heart-value">{{ h.last.bpm }}</span>
          <span class="heart-unit">battiti al minuto, alle {{ clockText(h.last.ts) }}</span>
        </p>
        <app-day-hr-chart [points]="h.points" [nowMin]="nowMin()" [resting]="resting()" [gapMin]="gapMin()"></app-day-hr-chart>
        <p class="heart-note">
          Oggi da {{ h.low.bpm }} a {{ h.high.bpm }} battiti al minuto. L'anello lo misura da solo ogni {{ intervalMin() }}
          minuti, quando lo porti.
          @if (resting() !== null) {
            La linea tratteggiata è il tuo battito a riposo di notte.
          }
        </p>
      } @else {
        <p class="heart-note">Nessuna misura oggi. Il battito arriva con la prossima lettura dell'anello.</p>
      }
    </section>
  `,
})
export class HeartTodayComponent {
  readonly heart = input.required<HeartToday | null>();
  readonly nowMin = input<number | null>(null);
  readonly resting = input<number | null>(null);
  readonly intervalMin = input(5);
  readonly gapMin = input(20);

  protected readonly clockText = timeText;
}
