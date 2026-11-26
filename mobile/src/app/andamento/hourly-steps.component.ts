import { Component, computed, input } from '@angular/core';
import { ACTIVE_HOUR_STEPS, activeHours } from './andamento.model';

const WIDTH = 340;
const HEIGHT = 90;
const GAP = 3;
const BAR_WIDTH = (WIDTH - GAP * 23) / 24;

/**
 * Passi ora per ora. Le ore «attive» (almeno 250 passi) hanno il colore del dominio, le altre sono grigie:
 * la differenza è anche di tono, e il totale delle ore attive è scritto sotto.
 */
@Component({
  selector: 'app-hourly-steps',
  styleUrl: './hourly-steps.component.scss',
  template: `
    <svg class="chart" [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="summary()">
      <line class="threshold" x1="0" [attr.x2]="width" [attr.y1]="thresholdY()" [attr.y2]="thresholdY()"></line>
      @for (bar of bars(); track bar.hour) {
        <rect
          class="bar"
          [class.is-active]="bar.active"
          [attr.x]="bar.x"
          [attr.y]="bar.y"
          [attr.width]="barWidth"
          [attr.height]="bar.height"
          rx="2"
        ></rect>
      }
    </svg>
    <div class="axis" aria-hidden="true">
      <span>0</span>
      <span>6</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  `,
})
export class HourlyStepsComponent {
  /** 24 valori, uno per ora, dalla mezzanotte. */
  readonly steps = input.required<readonly number[]>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly barWidth = BAR_WIDTH;

  private readonly max = computed(() => Math.max(...this.steps(), ACTIVE_HOUR_STEPS * 2));
  protected readonly thresholdY = computed(() => this.yFor(ACTIVE_HOUR_STEPS));
  protected readonly bars = computed(() =>
    this.steps().map((value, hour) => {
      const top = this.yFor(value);
      return {
        hour,
        x: Math.round((hour * (BAR_WIDTH + GAP)) * 10) / 10,
        y: top,
        // Anche un'ora senza passi lascia un segno di 2 px: la colonna esiste, è solo vuota.
        height: Math.max(2, HEIGHT - top),
        active: value >= ACTIVE_HOUR_STEPS,
      };
    }),
  );
  protected readonly summary = computed(
    () => `Passi ora per ora: ${activeHours(this.steps())} ore con almeno ${ACTIVE_HOUR_STEPS} passi su 24`,
  );

  private yFor(value: number): number {
    return Math.round((HEIGHT - (value / this.max()) * (HEIGHT - 4)) * 10) / 10;
  }
}
