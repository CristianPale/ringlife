import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatElapsed } from '../session/session.model';

export interface HrPoint {
  /** Millisecondi dall'inizio della sessione. */
  t: number;
  bpm: number;
}

const W = 340;
const H = 190;
const LEFT = 34;
const RIGHT = 10;
const TOP = 26;
const BOTTOM = 24;
const MINUTE_STEPS = [1, 2, 5, 10, 15, 30, 60];

/**
 * Grafico del battito di una sessione: asse orizzontale in minuti, verticale in battiti al minuto. Dal vivo segue la
 * misura; a sessione finita (`interactive`) un tocco o il trascinamento mostra minuto e battito del punto più vicino,
 * e le frecce della tastiera lo spostano.
 */
@Component({
  selector: 'app-hr-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      touch-action: pan-y;
      outline: none;
    }
    .grid {
      stroke: var(--rl-line);
      stroke-width: 1;
    }
    .axis {
      stroke: var(--rl-text-2);
      stroke-width: 1;
    }
    .tick {
      fill: var(--rl-text-2);
      font-family: var(--rl-font-mono);
      font-size: 10px;
    }
    .line {
      fill: none;
      stroke: var(--rl-text);
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .cursor {
      stroke: var(--rl-text-2);
      stroke-width: 1;
      stroke-dasharray: 3 3;
    }
    .dot {
      fill: var(--rl-ok);
      stroke: var(--rl-bg);
      stroke-width: 2;
    }
    .label-box {
      fill: var(--rl-surface-2);
      stroke: var(--rl-chip-border);
    }
    .label {
      fill: var(--rl-text);
      font-family: var(--rl-font-mono);
      font-size: 11px;
    }
  `,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      role="img"
      [attr.aria-label]="description()"
      [attr.tabindex]="interactive() ? 0 : null"
      (pointerdown)="pick($event)"
      (pointermove)="drag($event)"
      (keydown)="key($event)"
    >
      @for (tick of yTicks(); track tick.value) {
        <line class="grid" [attr.x1]="left" [attr.x2]="width - right" [attr.y1]="tick.y" [attr.y2]="tick.y"></line>
        <text class="tick" [attr.x]="left - 6" [attr.y]="tick.y + 3" text-anchor="end">{{ tick.value }}</text>
      }
      <line class="axis" [attr.x1]="left" [attr.x2]="left" [attr.y1]="top" [attr.y2]="height - bottom"></line>
      <line class="axis" [attr.x1]="left" [attr.x2]="width - right" [attr.y1]="height - bottom" [attr.y2]="height - bottom"></line>
      @for (tick of xTicks(); track tick.label) {
        <text class="tick" [attr.x]="tick.x" [attr.y]="height - 8" text-anchor="middle">{{ tick.label }}</text>
      }
      <text class="tick" [attr.x]="width - right" [attr.y]="height - 8" text-anchor="end">min</text>
      <text class="tick" [attr.x]="left - 6" [attr.y]="top - 12" text-anchor="end">bpm</text>
      @if (path(); as p) {
        <polyline class="line" [attr.points]="p"></polyline>
      }
      @if (live() && lastPoint(); as last) {
        <circle class="dot" [attr.cx]="last.x" [attr.cy]="last.y" r="4"></circle>
      }
      @if (selected(); as s) {
        <line class="cursor" [attr.x1]="s.x" [attr.x2]="s.x" [attr.y1]="top" [attr.y2]="height - bottom"></line>
        <circle class="dot" [attr.cx]="s.x" [attr.cy]="s.y" r="4.5"></circle>
        <rect class="label-box" [attr.x]="s.boxX" y="2" width="128" height="18" rx="6"></rect>
        <text class="label" [attr.x]="s.boxX + 64" y="15" text-anchor="middle">{{ s.text }}</text>
      }
    </svg>
  `,
})
export class HrChartComponent {
  readonly points = input.required<readonly HrPoint[]>();
  /** Tocco e tastiera mostrano il dettaglio minuto-battito. */
  readonly interactive = input(false);
  /** Durante la misura: punto sull'ultimo valore. */
  readonly live = input(false);

  protected readonly width = W;
  protected readonly height = H;
  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly top = TOP;
  protected readonly bottom = BOTTOM;

  private readonly index = signal<number | null>(null);

  private readonly scale = computed(() => {
    const pts = this.points();
    const values = pts.map((p) => p.bpm);
    const lo = values.length ? Math.floor((Math.min(...values) - 5) / 10) * 10 : 50;
    const hi = values.length ? Math.ceil((Math.max(...values) + 5) / 10) * 10 : 100;
    // Dal vivo l'asse dei minuti parte da almeno 1 minuto, così la linea non si allarga a scatti all'inizio.
    const tMax = Math.max(this.live() ? 60_000 : 1, pts.length ? pts[pts.length - 1].t : 0);
    const x = (t: number) => LEFT + (t / tMax) * (W - LEFT - RIGHT);
    const y = (bpm: number) => H - BOTTOM - ((bpm - lo) / (hi - lo)) * (H - BOTTOM - TOP);
    return { lo, hi, tMax, x, y };
  });

  protected readonly path = computed(() => {
    const { x, y } = this.scale();
    const pts = this.points();
    return pts.length < 2 ? null : pts.map((p) => `${x(p.t).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ');
  });

  protected readonly lastPoint = computed(() => {
    const pts = this.points();
    const { x, y } = this.scale();
    return pts.length ? { x: x(pts[pts.length - 1].t), y: y(pts[pts.length - 1].bpm) } : null;
  });

  protected readonly yTicks = computed(() => {
    const { lo, hi, y } = this.scale();
    const step = hi - lo > 60 ? 20 : 10;
    const ticks: { value: number; y: number }[] = [];
    for (let v = lo; v <= hi; v += step) {
      ticks.push({ value: v, y: y(v) });
    }
    return ticks;
  });

  protected readonly xTicks = computed(() => {
    const { tMax, x } = this.scale();
    const minutes = tMax / 60_000;
    const step = MINUTE_STEPS.find((s) => minutes / s <= 6) ?? 60;
    const ticks: { label: string; x: number }[] = [];
    for (let m = 0; m <= minutes + 1e-9; m += step) {
      ticks.push({ label: String(m), x: x(m * 60_000) });
    }
    return ticks;
  });

  protected readonly selected = computed(() => {
    const i = this.index();
    const pts = this.points();
    if (!this.interactive() || i === null || i >= pts.length) {
      return null;
    }
    const { x, y } = this.scale();
    const p = pts[i];
    const px = x(p.t);
    return {
      x: px,
      y: y(p.bpm),
      boxX: Math.max(2, Math.min(W - 130, px - 64)),
      text: `${formatElapsed(p.t)} · ${p.bpm} bpm`,
    };
  });

  protected readonly description = computed(() => {
    const pts = this.points();
    if (pts.length === 0) {
      return 'Battito: ancora nessun valore.';
    }
    const values = pts.map((p) => p.bpm);
    return `Battito in ${formatElapsed(pts[pts.length - 1].t)}: da ${Math.min(...values)} a ${Math.max(...values)} battiti al minuto.`;
  });

  protected pick(event: PointerEvent): void {
    if (!this.interactive()) {
      return;
    }
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / (rect.width || 1)) * W;
    this.index.set(this.nearest(vx));
  }

  protected drag(event: PointerEvent): void {
    if (event.buttons > 0 || event.pointerType === 'touch') {
      this.pick(event);
    }
  }

  protected key(event: KeyboardEvent): void {
    const pts = this.points();
    if (!this.interactive() || pts.length === 0) {
      return;
    }
    const current = this.index() ?? 0;
    if (event.key === 'ArrowRight') {
      this.index.set(Math.min(pts.length - 1, current + 1));
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      this.index.set(Math.max(0, current - 1));
      event.preventDefault();
    }
  }

  /** L'indice del punto più vicino in orizzontale a `vx` (coordinate del disegno). */
  nearest(vx: number): number | null {
    const pts = this.points();
    if (pts.length === 0) {
      return null;
    }
    const { x } = this.scale();
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(x(pts[i].t) - vx) < Math.abs(x(pts[best].t) - vx)) {
        best = i;
      }
    }
    return best;
  }

  /** Solo per i test: seleziona un punto. */
  select(index: number): void {
    this.index.set(index);
  }
}
