import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DayHrPoint, segments } from './heart-today';

const W = 340;
const H = 160;
const LEFT = 30;
const RIGHT = 10;
const TOP = 26;
const BOTTOM = 22;
const DAY_MIN = 24 * 60;
const HOURS = [0, 6, 12, 18, 24];

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Il battito di oggi misurato dall'anello da solo (docs/adr/0035): asse orizzontale dalla mezzanotte a mezzanotte,
 * verticale in battiti al minuto. La linea si interrompe dove l'anello non ha misurato. La linea tratteggiata è il tuo
 * battito a riposo di notte, la tua media. Un tocco, il trascinamento o le frecce mostrano ora e battito di una misura.
 */
@Component({
  selector: 'app-day-hr-chart',
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
    svg:focus-visible {
      outline: 2px solid var(--rl-text-2);
      outline-offset: 2px;
      border-radius: 8px;
    }
    .grid {
      stroke: var(--rl-line);
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
      stroke-width: 1.6;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .single {
      fill: var(--rl-text);
    }
    .resting {
      stroke: var(--rl-text-2);
      stroke-width: 1;
      stroke-dasharray: 4 4;
    }
    .now {
      stroke: var(--rl-line);
      stroke-width: 1;
      stroke-dasharray: 2 3;
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
      tabindex="0"
      [attr.aria-label]="description()"
      (pointerdown)="pick($event)"
      (pointermove)="drag($event)"
      (keydown)="key($event)"
    >
      @for (tick of yTicks(); track tick.value) {
        <line class="grid" [attr.x1]="left" [attr.x2]="width - right" [attr.y1]="tick.y" [attr.y2]="tick.y"></line>
        <text class="tick" [attr.x]="left - 6" [attr.y]="tick.y + 3" text-anchor="end">{{ tick.value }}</text>
      }
      @for (tick of xTicks; track tick.label) {
        <text class="tick" [attr.x]="tick.x" [attr.y]="height - 6" [attr.text-anchor]="tick.anchor">{{ tick.label }}</text>
      }
      @if (restingY(); as y) {
        <line class="resting" [attr.x1]="left" [attr.x2]="width - right" [attr.y1]="y" [attr.y2]="y"></line>
      }
      @if (nowX(); as x) {
        <line class="now" [attr.x1]="x" [attr.x2]="x" [attr.y1]="top" [attr.y2]="height - bottom"></line>
      }
      @for (seg of drawn(); track $index) {
        @if (seg.single; as p) {
          <circle class="single" [attr.cx]="p.x" [attr.cy]="p.y" r="1.8"></circle>
        } @else {
          <polyline class="line" [attr.points]="seg.path"></polyline>
        }
      }
      @if (selected(); as s) {
        <line class="cursor" [attr.x1]="s.x" [attr.x2]="s.x" [attr.y1]="top" [attr.y2]="height - bottom"></line>
        <circle class="dot" [attr.cx]="s.x" [attr.cy]="s.y" r="4.5"></circle>
        <rect class="label-box" [attr.x]="s.boxX" y="2" width="180" height="18" rx="6"></rect>
        <text class="label" [attr.x]="s.boxX + 90" y="15" text-anchor="middle">{{ s.text }}</text>
      }
    </svg>
  `,
})
export class DayHrChartComponent {
  readonly points = input.required<readonly DayHrPoint[]>();
  /** Minuti dalla mezzanotte di adesso: una linea sottile dice fin dove arriva la giornata. */
  readonly nowMin = input<number | null>(null);
  /** Il battito a riposo di notte, la tua media. `null` in calibrazione: niente linea. */
  readonly resting = input<number | null>(null);
  /** Oltre quanti minuti senza misure la linea si interrompe. */
  readonly gapMin = input(20);

  protected readonly width = W;
  protected readonly height = H;
  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly top = TOP;
  protected readonly bottom = BOTTOM;

  private readonly index = signal<number | null>(null);

  private readonly scale = computed(() => {
    const values = this.points().map((p) => p.bpm);
    const resting = this.resting();
    if (resting !== null) {
      values.push(resting);
    }
    const lo = values.length ? Math.floor((Math.min(...values) - 5) / 10) * 10 : 50;
    const hi = values.length ? Math.ceil((Math.max(...values) + 5) / 10) * 10 : 100;
    const x = (min: number) => LEFT + (min / DAY_MIN) * (W - LEFT - RIGHT);
    const y = (bpm: number) => H - BOTTOM - ((bpm - lo) / (hi - lo)) * (H - BOTTOM - TOP);
    return { lo, hi, x, y };
  });

  protected readonly xTicks = HOURS.map((h, i) => ({
    label: String(h).padStart(2, '0'),
    x: LEFT + (h / 24) * (W - LEFT - RIGHT),
    anchor: i === 0 ? 'start' : i === HOURS.length - 1 ? 'end' : 'middle',
  }));

  protected readonly yTicks = computed(() => {
    const { lo, hi, y } = this.scale();
    const step = hi - lo > 60 ? 20 : 10;
    const ticks: { value: number; y: number }[] = [];
    for (let v = lo; v <= hi; v += step) {
      ticks.push({ value: v, y: y(v) });
    }
    return ticks;
  });

  protected readonly drawn = computed(() => {
    const { x, y } = this.scale();
    return segments(this.points(), this.gapMin()).map((seg) =>
      seg.length === 1
        ? { single: { x: x(seg[0].min), y: y(seg[0].bpm) }, path: '' }
        : { single: null, path: seg.map((p) => `${x(p.min).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ') },
    );
  });

  protected readonly restingY = computed(() => {
    const resting = this.resting();
    return resting === null ? null : this.scale().y(resting);
  });

  protected readonly nowX = computed(() => {
    const now = this.nowMin();
    return now === null ? null : this.scale().x(Math.min(DAY_MIN, Math.max(0, now)));
  });

  protected readonly selected = computed(() => {
    const i = this.index();
    const pts = this.points();
    if (i === null || i >= pts.length) {
      return null;
    }
    const { x, y } = this.scale();
    const p = pts[i];
    const px = x(p.min);
    return {
      x: px,
      y: y(p.bpm),
      boxX: Math.max(2, Math.min(W - 182, px - 90)),
      text: `${hhmm(p.min)} · ${p.bpm} battiti al minuto`,
    };
  });

  protected readonly description = computed(() => {
    const pts = this.points();
    if (pts.length === 0) {
      return 'Battito di oggi: ancora nessuna misura.';
    }
    const values = pts.map((p) => p.bpm);
    const resting = this.resting();
    const usual = resting === null ? '' : ` Il tuo battito a riposo di notte è ${Math.round(resting)}.`;
    return `Battito di oggi dalle ${hhmm(pts[0].min)} alle ${hhmm(pts[pts.length - 1].min)}: da ${Math.min(...values)} a ${Math.max(...values)} battiti al minuto.${usual}`;
  });

  protected pick(event: PointerEvent): void {
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
    if (pts.length === 0) {
      return;
    }
    const current = this.index() ?? pts.length - 1;
    if (event.key === 'ArrowRight') {
      this.index.set(Math.min(pts.length - 1, current + 1));
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      this.index.set(Math.max(0, current - 1));
      event.preventDefault();
    }
  }

  /** L'indice della misura più vicina in orizzontale a `vx` (coordinate del disegno). */
  nearest(vx: number): number | null {
    const pts = this.points();
    if (pts.length === 0) {
      return null;
    }
    const { x } = this.scale();
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(x(pts[i].min) - vx) < Math.abs(x(pts[best].min) - vx)) {
        best = i;
      }
    }
    return best;
  }

  /** Solo per i test: seleziona una misura. */
  select(index: number): void {
    this.index.set(index);
  }
}
