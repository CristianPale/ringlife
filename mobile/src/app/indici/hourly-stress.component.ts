import { Component, computed, input } from '@angular/core';
import { HIGH_STRESS, WAKING_FROM, WAKING_TO } from './stress.model';

const WIDTH = 340;
const HEIGHT = 110;
const GAP = 4;
const HOURS = WAKING_TO - WAKING_FROM;
const BAR_WIDTH = (WIDTH - GAP * (HOURS - 1)) / HOURS;
const TOP = 6;

/**
 * Stress medio ora per ora, dalle 07:00 alle 23:00. Le ore con stress alto (60 o più) sono segnate con un colore
 * e con la linea tratteggiata della soglia; un'ora senza misure resta vuota. Il riepilogo è scritto per esteso
 * per chi non vede il colore.
 */
@Component({
  selector: 'app-hourly-stress',
  styleUrl: './hourly-stress.component.scss',
  template: `
    <svg class="chart" [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="summary()">
      <line class="threshold" x1="0" [attr.x2]="width" [attr.y1]="thresholdY" [attr.y2]="thresholdY"></line>
      @for (bar of bars(); track bar.hour) {
        @if (bar.value !== null) {
          <rect
            class="bar"
            [class.is-high]="bar.high"
            [attr.x]="bar.x"
            [attr.y]="bar.y"
            [attr.width]="barWidth"
            [attr.height]="bar.height"
            rx="2"
          ></rect>
        } @else {
          <line class="empty" [attr.x1]="bar.x" [attr.x2]="bar.x + barWidth" [attr.y1]="height - 1" [attr.y2]="height - 1"></line>
        }
      }
    </svg>
    <div class="axis" aria-hidden="true">
      <span>7</span>
      <span>11</span>
      <span>15</span>
      <span>19</span>
      <span>23</span>
    </div>
  `,
})
export class HourlyStressComponent {
  /** 24 valori, uno per ora dalla mezzanotte: lo stress medio dell'ora, `null` senza misure. */
  readonly values = input.required<readonly (number | null)[]>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly barWidth = BAR_WIDTH;
  protected readonly thresholdY = this.yFor(HIGH_STRESS);

  protected readonly bars = computed(() =>
    this.values()
      .slice(WAKING_FROM, WAKING_TO)
      .map((value, i) => {
        const y = value === null ? HEIGHT : this.yFor(value);
        return {
          hour: WAKING_FROM + i,
          value,
          x: Math.round(i * (BAR_WIDTH + GAP) * 10) / 10,
          y,
          height: Math.max(2, HEIGHT - y),
          high: value !== null && value >= HIGH_STRESS,
        };
      }),
  );

  protected readonly summary = computed(() => {
    const shown = this.values().slice(WAKING_FROM, WAKING_TO).filter((v): v is number => v !== null);
    const high = shown.filter((v) => v >= HIGH_STRESS).length;
    return `Stress ora per ora: ${high} ${high === 1 ? 'ora' : 'ore'} con stress alto (${HIGH_STRESS} o più) su ${shown.length} con misure`;
  });

  private yFor(value: number): number {
    const clamped = Math.max(0, Math.min(100, value));
    return Math.round((HEIGHT - (clamped / 100) * (HEIGHT - TOP)) * 10) / 10;
  }
}
