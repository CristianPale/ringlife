import { Component, computed, input, output, signal } from '@angular/core';
import { dayName } from '../shared/day-history';
import { NormalBand, isOutside } from './andamento.model';
import { BAND_HEIGHT, BAND_PLOT, BAND_WIDTH, bandGeometry } from './band-chart';

/**
 * Serie con la tua fascia normale: banda grigia, linea tratteggiata sulla mediana, linea della serie.
 * I giorni fuori fascia hanno un punto ambra; l'ultimo giorno è evidenziato. Lo stato dell'ultimo punto
 * è sempre scritto a parole sotto il grafico, mai solo colore.
 *
 * Con `dates` e `format` il grafico si legge al tocco: un tocco (o le frecce della tastiera) sceglie il punto più vicino
 * e sotto compare il riassunto di quel giorno; con `openable` anche «Apri il giorno», che emette `opened`.
 */
@Component({
  selector: 'app-band-chart',
  styleUrl: './band-chart.component.scss',
  host: { '[attr.data-domain]': 'domain()' },
  template: `
    <svg
      class="chart"
      [class.is-interactive]="interactive()"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      role="img"
      [attr.aria-label]="summary()"
      [attr.tabindex]="interactive() ? 0 : null"
      (pointerdown)="pick($event)"
      (pointermove)="drag($event)"
      (keydown)="key($event)"
    >
      <rect
        class="band"
        [attr.x]="plot.left"
        [attr.y]="geometry().bandTop"
        [attr.width]="plot.right - plot.left"
        [attr.height]="geometry().bandBottom - geometry().bandTop"
        rx="4"
      ></rect>
      <line class="median" [attr.x1]="plot.left" [attr.x2]="plot.right" [attr.y1]="geometry().medianY" [attr.y2]="geometry().medianY"></line>
      <polyline class="line" [attr.points]="geometry().line"></polyline>
      @for (point of geometry().points; track $index) {
        @if (point.outside && $index !== lastIndex()) {
          <circle class="dot-out" [attr.cx]="point.x" [attr.cy]="point.y" r="3.5"></circle>
        }
      }
      <circle
        class="dot-last"
        [class.is-out]="lastOutside()"
        [attr.cx]="last().x"
        [attr.cy]="last().y"
        r="5"
      ></circle>
      @if (picked(); as p) {
        <line class="cursor" [attr.x1]="p.x" [attr.x2]="p.x" y1="0" [attr.y2]="height"></line>
        <circle class="dot-picked" [attr.cx]="p.x" [attr.cy]="p.y" r="6"></circle>
      }
    </svg>
    @if (picked(); as p) {
      <div class="readout">
        <p role="status">
          <strong>{{ p.day }}</strong>: {{ p.value }} · {{ p.state }}
        </p>
        @if (openable()(p.iso)) {
          <button type="button" class="open" (click)="opened.emit(p.iso)">Apri il giorno</button>
        }
      </div>
    }
  `,
})
export class BandChartComponent {
  readonly values = input.required<readonly number[]>();
  readonly band = input.required<NormalBand>();
  /** Nome della serie per chi usa uno screen reader. */
  readonly label = input.required<string>();
  readonly domain = input<'recupero' | 'sonno' | 'movimento'>('recupero');
  /** Il giorno di ogni valore, `2026-11-17`. Con `format` rende il grafico leggibile al tocco. */
  readonly dates = input<readonly string[] | null>(null);
  readonly format = input<((value: number) => string) | null>(null);
  /** Se il giorno scelto si può aprire nel suo dettaglio: allora compare «Apri il giorno». */
  readonly openable = input<(day: string) => boolean>(() => false);
  /** Il giorno da aprire, `2026-11-17`. */
  readonly opened = output<string>();

  private readonly index = signal<number | null>(null);
  protected readonly interactive = computed(() => {
    const dates = this.dates();
    return dates !== null && this.format() !== null && dates.length === this.values().length && dates.length > 0;
  });

  protected readonly width = BAND_WIDTH;
  protected readonly height = BAND_HEIGHT;
  protected readonly plot = BAND_PLOT;

  protected readonly geometry = computed(() => bandGeometry(this.values(), this.band()));
  protected readonly lastIndex = computed(() => this.values().length - 1);
  protected readonly last = computed(() => this.geometry().points[this.lastIndex()] ?? { x: 0, y: 0, outside: false });
  protected readonly lastOutside = computed(() => this.last().outside);
  protected readonly summary = computed(() => {
    const values = this.values();
    const outside = values.filter((v) => isOutside(v, this.band())).length;
    const touch = this.interactive() ? '. Tocca un punto, o usa le frecce, per leggere un giorno' : '';
    return `${this.label()}, ultimi ${values.length} giorni: ${outside} giorni fuori dalla tua fascia normale${touch}`;
  });

  /** Il punto scelto con il suo riassunto: giorno, valore, e dove sta rispetto alla tua fascia. */
  protected readonly picked = computed(() => {
    const i = this.index();
    const values = this.values();
    const dates = this.dates();
    const format = this.format();
    if (!this.interactive() || i === null || i >= values.length || !dates || !format) {
      return null;
    }
    const point = this.geometry().points[i];
    const value = values[i];
    const band = this.band();
    const state = value > band.high ? 'sopra la tua fascia' : value < band.low ? 'sotto la tua fascia' : 'nella tua fascia';
    const day = dayName(dates[i], new Date());
    return {
      x: point.x,
      y: point.y,
      iso: dates[i],
      day: day.charAt(0).toUpperCase() + day.slice(1),
      value: format(value),
      state,
    };
  });

  protected pick(event: PointerEvent): void {
    if (!this.interactive()) {
      return;
    }
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / (rect.width || 1)) * BAND_WIDTH;
    this.index.set(this.nearest(vx));
  }

  protected drag(event: PointerEvent): void {
    if (event.buttons > 0 || event.pointerType === 'touch') {
      this.pick(event);
    }
  }

  protected key(event: KeyboardEvent): void {
    const count = this.values().length;
    if (!this.interactive() || count === 0) {
      return;
    }
    const current = this.index() ?? count - 1;
    if (event.key === 'ArrowLeft') {
      this.index.set(Math.max(0, current - 1));
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      this.index.set(Math.min(count - 1, current + 1));
      event.preventDefault();
    }
  }

  /** L'indice del punto più vicino in orizzontale a `vx` (coordinate del disegno). */
  nearest(vx: number): number | null {
    const points = this.geometry().points;
    if (points.length === 0) {
      return null;
    }
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - vx) < Math.abs(points[best].x - vx)) {
        best = i;
      }
    }
    return best;
  }

  /** Solo per i test: sceglie un punto. */
  select(index: number): void {
    this.index.set(index);
  }
}
