import { Component, computed, input } from '@angular/core';
import { CHART_HEIGHT, CHART_WIDTH, areaPath, chartPoints, polyline, seriesStats, yFor } from './trend-chart';

/** Valori di riferimento disegnati sul grafico: le soglie delle zone (analisi.md, 5.1). */
const GUIDES = [85, 70] as const;

/** Andamento di un indice 0-100: linea, area e soglie delle zone. Il testo sotto riassume la serie. */
@Component({
  selector: 'app-trend-chart',
  styleUrl: './trend-chart.component.scss',
  host: { '[attr.data-domain]': 'domain()' },
  template: `
    <svg
      class="chart"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      role="img"
      [attr.aria-label]="summary()"
    >
      @for (guide of guides; track guide) {
        <line class="guide" x1="28" [attr.x2]="width - 8" [attr.y1]="y(guide)" [attr.y2]="y(guide)"></line>
        <text class="guide-label" x="0" [attr.y]="y(guide) + 4">{{ guide }}</text>
      }
      <path class="area" [attr.d]="area()"></path>
      <polyline class="line" [attr.points]="line()"></polyline>
      <circle class="dot" [attr.cx]="last().x" [attr.cy]="last().y" r="4.5"></circle>
    </svg>
    <div class="axis" aria-hidden="true">
      <span>{{ values().length }} giorni fa</span>
      <span>oggi</span>
    </div>
    <p class="stats">
      <span>Media <strong>{{ stats().average }}</strong></span>
      <span>Minimo <strong>{{ stats().min }}</strong></span>
      <span>Massimo <strong>{{ stats().max }}</strong></span>
    </p>
  `,
})
export class TrendChartComponent {
  /** Serie giornaliera dal più vecchio al più recente. Almeno un valore. */
  readonly values = input.required<readonly number[]>();
  readonly label = input('Andamento');
  readonly domain = input<'recupero' | 'sonno' | 'stress'>('recupero');

  protected readonly width = CHART_WIDTH;
  protected readonly height = CHART_HEIGHT;
  protected readonly guides = GUIDES;

  private readonly points = computed(() => chartPoints(this.values()));
  protected readonly line = computed(() => polyline(this.points()));
  protected readonly area = computed(() => areaPath(this.points()));
  protected readonly last = computed(() => this.points()[this.points().length - 1] ?? { x: 0, y: 0 });
  protected readonly stats = computed(() => seriesStats(this.values()));
  protected readonly summary = computed(() => {
    const values = this.values();
    const stats = this.stats();
    return `${this.label()}, ultimi ${values.length} giorni: da ${values[0]} a ${values[values.length - 1]}, media ${stats.average}`;
  });

  protected y(value: number): number {
    return yFor(value);
  }
}
